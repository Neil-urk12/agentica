//! M1 contracts. Mind-map operations and agent execution remain capability gated.

use serde::Deserialize;
use serde_json::Value;

use crate::commands::{id, invalid, label, revision, text};
use crate::store::RuntimeError;

#[derive(Deserialize)]
#[serde(tag = "op", deny_unknown_fields, rename_all_fields = "camelCase")]
pub(crate) enum ArtifactOperation {
    #[serde(rename = "text.replace")]
    ReplaceText {
        artifact_id: String,
        expected_revision: f64,
        text: String,
    },
    #[serde(rename = "mindmap.addTopic")]
    AddTopic {
        artifact_id: String,
        expected_revision: f64,
        topic_id: String,
        #[serde(deserialize_with = "nullable_parent")]
        parent_id: Option<String>,
        title: String,
    },
    #[serde(rename = "mindmap.renameTopic")]
    RenameTopic {
        artifact_id: String,
        expected_revision: f64,
        topic_id: String,
        title: String,
    },
    #[serde(rename = "mindmap.moveTopic")]
    MoveTopic {
        artifact_id: String,
        expected_revision: f64,
        topic_id: String,
        #[serde(deserialize_with = "nullable_parent")]
        parent_id: Option<String>,
    },
    #[serde(rename = "mindmap.removeTopic")]
    RemoveTopic {
        artifact_id: String,
        expected_revision: f64,
        topic_id: String,
    },
}

fn nullable_parent<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}

impl ArtifactOperation {
    pub(crate) fn reference(&self) -> (&str, f64) {
        match self {
            Self::ReplaceText {
                artifact_id,
                expected_revision,
                ..
            }
            | Self::AddTopic {
                artifact_id,
                expected_revision,
                ..
            }
            | Self::RenameTopic {
                artifact_id,
                expected_revision,
                ..
            }
            | Self::MoveTopic {
                artifact_id,
                expected_revision,
                ..
            }
            | Self::RemoveTopic {
                artifact_id,
                expected_revision,
                ..
            } => (artifact_id, *expected_revision),
        }
    }

    fn validate(&self) -> Result<(), RuntimeError> {
        let (artifact_id, expected) = self.reference();
        id("artifactId", artifact_id)?;
        revision(expected)?;
        match self {
            Self::ReplaceText { text: body, .. } => text(body),
            Self::AddTopic {
                topic_id,
                parent_id,
                title,
                ..
            } => {
                label("title", title)?;
                topic(topic_id, parent_id.as_deref())
            }
            Self::MoveTopic {
                topic_id,
                parent_id,
                ..
            } => topic(topic_id, parent_id.as_deref()),
            Self::RenameTopic {
                topic_id, title, ..
            } => {
                id("topicId", topic_id)?;
                label("title", title)
            }
            Self::RemoveTopic { topic_id, .. } => id("topicId", topic_id),
        }
    }
}

fn topic(topic_id: &str, parent_id: Option<&str>) -> Result<(), RuntimeError> {
    id("topicId", topic_id)?;
    if let Some(parent_id) = parent_id {
        id("parentId", parent_id)?;
        if parent_id == topic_id {
            return Err(invalid("A topic cannot parent itself."));
        }
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ArtifactBatch {
    pub workspace_id: String,
    pub canvas_id: String,
    pub operations: Vec<ArtifactOperation>,
}

impl ArtifactBatch {
    pub(crate) fn validate(&self) -> Result<(), RuntimeError> {
        id("workspaceId", &self.workspace_id)?;
        id("canvasId", &self.canvas_id)?;
        if self.operations.is_empty() || self.operations.len() > 32 {
            return Err(invalid("A batch must contain 1 to 32 operations."));
        }
        let mut seen = std::collections::HashSet::new();
        for operation in &self.operations {
            operation.validate()?;
            if !seen.insert(operation.reference().0) {
                return Err(invalid("Use one operation per artifact in a batch."));
            }
        }
        Ok(())
    }
}

pub(crate) fn validate_agent_start(params: Value) -> Result<(), RuntimeError> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Start {
        workspace_id: String,
        canvas_id: String,
        instruction_artifact_id: String,
        read_artifact_ids: Vec<String>,
        write_artifact_ids: Vec<String>,
    }
    let scope: Start =
        serde_json::from_value(params).map_err(|e| invalid(format!("Invalid run scope: {e}.")))?;
    id("workspaceId", &scope.workspace_id)?;
    id("canvasId", &scope.canvas_id)?;
    id("instructionArtifactId", &scope.instruction_artifact_id)?;
    for ids in [&scope.read_artifact_ids, &scope.write_artifact_ids] {
        let mut seen = std::collections::HashSet::new();
        if ids.len() > 128 {
            return Err(invalid("Run scopes are limited to 128 artifacts."));
        }
        for artifact_id in ids {
            id("artifactId", artifact_id)?;
            if !seen.insert(artifact_id) {
                return Err(invalid("Scope IDs must be unique."));
            }
        }
    }
    if !scope
        .read_artifact_ids
        .contains(&scope.instruction_artifact_id)
        || scope
            .write_artifact_ids
            .iter()
            .any(|id| !scope.read_artifact_ids.contains(id))
    {
        return Err(invalid(
            "Instructions and writable artifacts must be in the read scope.",
        ));
    }
    Ok(())
}

pub(crate) const CODEX_UNSUPPORTED: &str = "Codex execution is unsupported: provider tool restrictions, approval mediation, and OS isolation have not been verified. Use manual editing or OpenRouter text generation; neither starts a Codex run.";

/// Validate normalized events independently of any provider's wire format.
/// This is a complete history validator, not a streaming run supervisor.
pub fn validate_run_history(value: Value) -> Result<(), String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Event {
        protocol_version: f64,
        request_id: String,
        run_id: String,
        sequence: f64,
        event: Payload,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct AppliedRevision {
        artifact_id: String,
        revision: f64,
    }
    #[derive(Deserialize)]
    #[serde(tag = "type", deny_unknown_fields)]
    enum Payload {
        #[serde(rename = "started")]
        Started,
        #[serde(rename = "batchApplied")]
        BatchApplied { revisions: Vec<AppliedRevision> },
        #[serde(rename = "textDelta")]
        TextDelta { text: String },
        #[serde(rename = "cancelRequested")]
        CancelRequested,
        #[serde(rename = "completed")]
        Completed,
        #[serde(rename = "cancelled")]
        Cancelled,
        #[serde(rename = "failed")]
        Failed { code: String, message: String },
    }
    let events: Vec<Event> = serde_json::from_value(value).map_err(|e| e.to_string())?;
    if events.len() > 128 {
        return Err("History exceeds 128 events.".into());
    }
    let mut cancelling = false;
    let mut terminal = false;
    for (index, event) in events.iter().enumerate() {
        let first = &events[0];
        if event.protocol_version != 1.0
            || id("runId", &event.run_id).is_err()
            || event.request_id.is_empty()
            || event.request_id.encode_utf16().count() > 128
            || event.sequence != (index + 1) as f64
            || event.run_id != first.run_id
            || event.request_id != first.request_id
            || terminal
            || (index == 0) != matches!(event.event, Payload::Started)
            || (cancelling && !matches!(event.event, Payload::Cancelled | Payload::Failed { .. }))
            || (matches!(event.event, Payload::Cancelled) && !cancelling)
        {
            return Err("Invalid run event order or correlation.".into());
        }
        match &event.event {
            Payload::BatchApplied { revisions } => {
                let mut seen = std::collections::HashSet::new();
                if revisions.is_empty()
                    || revisions.len() > 32
                    || revisions.iter().any(|item| {
                        id("artifactId", &item.artifact_id).is_err()
                            || revision(item.revision).is_err()
                            || !seen.insert(&item.artifact_id)
                    })
                {
                    return Err("Committed revisions must contain 1 to 32 unique artifact IDs and safe revisions.".into());
                }
            }
            Payload::TextDelta { text }
                if text.is_empty() || text.encode_utf16().count() > 2_000 =>
            {
                return Err("Text delta must contain 1 to 2000 characters.".into())
            }
            Payload::Failed { code, message }
                if !ERROR_CODES.contains(&code.as_str())
                    || message.is_empty()
                    || message.encode_utf16().count() > 1_000 =>
            {
                return Err("Invalid actionable run error.".into())
            }
            Payload::CancelRequested => cancelling = true,
            Payload::Completed | Payload::Cancelled | Payload::Failed { .. } => terminal = true,
            _ => {}
        }
    }
    Ok(())
}

const ERROR_CODES: &[&str] = &[
    "INVALID_JSON",
    "INVALID_REQUEST",
    "FRAME_TOO_LARGE",
    "INVALID_PARAMS",
    "WORKSPACE_LOCKED",
    "WORKSPACE_NOT_OPEN",
    "NOT_FOUND",
    "CONFLICT",
    "UNSUPPORTED_STORAGE",
    "STORAGE_ERROR",
    "UNSUPPORTED_CAPABILITY",
    "SCOPE_DENIED",
    "BACKPRESSURE",
    "INVALID_EVENT_ORDER",
];
