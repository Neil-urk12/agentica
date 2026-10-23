//! Local feedback records; no Git, filesystem paths, or session commands execute here.
use super::{conflict, id, invalid, not_found, parse, revision, MAX_REVISION};
use crate::store::RuntimeError;
use rusqlite::{OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Hunk {
    header: String,
    range: String,
    fingerprint: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Record {
    id: String,
    order: u64,
    path: String,
    section: String,
    #[serde(deserialize_with = "nullable_hunk")]
    hunk: Option<Hunk>,
    comment: String,
    sent: bool,
    outdated: bool,
}
fn nullable_hunk<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Hunk>, D::Error> {
    Option::<Hunk>::deserialize(d)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Params {
    workspace_id: String,
    canvas_id: String,
    project_id: String,
    tile_id: String,
    expected_revision: Option<f64>,
    after: Option<String>,
    record: Option<Record>,
    delete_id: Option<String>,
}

fn record_id(value: &str) -> Result<(), RuntimeError> {
    if value == "composer" {
        Ok(())
    } else {
        id("recordId", value)
    }
}

fn payload(record: &Record) -> Result<String, RuntimeError> {
    record_id(&record.id)?;
    let valid_hunk = record.hunk.as_ref().is_none_or(|h| {
        h.header.len() <= 1024
            && h.range.len() <= 256
            && h.fingerprint.len() == 64
            && h.fingerprint
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    });
    if record.order > MAX_REVISION
        || record.path.is_empty()
        || record.path.len() > 4096
        || record.path.contains('\0')
        || record.comment.len() > 4000
        || !valid_hunk
        || !["staged", "unstaged", "untracked"].contains(&record.section.as_str())
    {
        return Err(invalid(
            "Feedback exceeds a field limit; shorten or copy the text.",
        ));
    }
    let encoded = serde_json::to_string(record).map_err(|_| invalid("Invalid feedback record."))?;
    if encoded.len() > 12 * 1024 {
        return Err(invalid(
            "Feedback record is too large; shorten or copy the text.",
        ));
    }
    Ok(encoded)
}

pub(super) fn call(
    tx: &Transaction<'_>,
    method: &str,
    params: Value,
) -> Result<Value, RuntimeError> {
    if ["expectedRevision", "after", "record", "deleteId"]
        .iter()
        .any(|key| params.get(key).is_some_and(Value::is_null))
    {
        return Err(invalid("Optional review fields cannot be null."));
    }
    // Match strict method-specific wire schemas before sharing the scope parser.
    if (method.ends_with("load")
        && (params.get("record").is_some() || params.get("deleteId").is_some()))
        || (method.ends_with("save") && params.get("after").is_some())
    {
        return Err(invalid("Invalid review parameters."));
    }
    let p: Params = parse(params)?;
    for (field, value) in [
        ("workspaceId", &p.workspace_id),
        ("canvasId", &p.canvas_id),
        ("projectId", &p.project_id),
        ("tileId", &p.tile_id),
    ] {
        id(field, value)?;
    }
    let current: i64 = tx.query_row("SELECT review_revision FROM changes_tile WHERE id=?1 AND canvas_id=?2 AND project_id=?3", (&p.tile_id, &p.canvas_id, &p.project_id), |r| r.get(0))
        .optional()?.ok_or_else(|| not_found("Changes tile"))?;
    if let Some(expected) = p.expected_revision {
        if revision(expected)? != current {
            return Err(conflict("review", current));
        }
    }
    if method.ends_with("load") {
        if let Some(after) = &p.after {
            record_id(after)?;
        }
        if p.after.is_some() && p.expected_revision.is_none() {
            return Err(invalid("Paged review reads require expectedRevision."));
        }
        let mut statement = tx.prepare(
            "SELECT id,payload FROM review_record WHERE tile_id=?1 AND id > ?2 ORDER BY id LIMIT 2",
        )?;
        let rows = statement
            .query_map((&p.tile_id, p.after.as_deref().unwrap_or("")), |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let record = rows
            .first()
            .map(|(_, body)| serde_json::from_str::<Value>(body))
            .transpose()
            .map_err(|_| {
                RuntimeError::new(
                    "STORAGE_ERROR",
                    "Cannot read saved feedback; copy local text and retry.",
                )
            })?;
        return Ok(
            json!({"revision":current,"record":record,"next":if rows.len()>1 {Some(&rows[0].0)} else {None}}),
        );
    }
    if p.expected_revision.is_none() || (p.record.is_none() && p.delete_id.is_none()) {
        return Err(invalid(
            "Provide expectedRevision and a record or deleteId.",
        ));
    }
    if let Some(delete) = &p.delete_id {
        record_id(delete)?;
        tx.execute(
            "DELETE FROM review_record WHERE tile_id=?1 AND id=?2",
            (&p.tile_id, delete),
        )?;
    }
    if let Some(record) = &p.record {
        let body = payload(record)?;
        tx.execute("INSERT INTO review_record(tile_id,id,payload) VALUES(?1,?2,?3) ON CONFLICT(tile_id,id) DO UPDATE SET payload=excluded.payload", (&p.tile_id, &record.id, body))?;
    }
    let count: i64 = tx.query_row(
        "SELECT count(*) FROM review_record WHERE tile_id=?1",
        [&p.tile_id],
        |r| r.get(0),
    )?;
    let comments: i64 = tx.query_row(
        "SELECT count(*) FROM review_record WHERE tile_id=?1 AND id <> 'composer'",
        [&p.tile_id],
        |r| r.get(0),
    )?;
    if count > 201 || comments > 200 {
        return Err(invalid(
            "A review can contain at most 200 comments and one composer; remove or copy feedback.",
        ));
    }
    if current as u64 >= MAX_REVISION {
        return Err(invalid("Review revision limit reached."));
    }
    tx.execute(
        "UPDATE changes_tile SET review_revision=review_revision+1 WHERE id=?1",
        [&p.tile_id],
    )?;
    Ok(json!({"revision":current+1}))
}
