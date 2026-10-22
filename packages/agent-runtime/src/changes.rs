//! Read-only Git status and diffs for a saved project's Changes tile.
//!
//! Served outside the workspace writer lock. The project folder comes from the
//! saved record, never from the client; Git runs with a fixed argv, no shell,
//! `GIT_OPTIONAL_LOCKS=0`, and a deadline. Unstaged diffs use `diff-files`,
//! which never refreshes or rewrites `.git/index`.
use std::{
    ffi::OsString,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::store::{is_id, RuntimeError};

pub const METHODS: &[&str] = &["changes.status", "changes.diff"];
const TIMEOUT: Duration = Duration::from_secs(10);
const STATUS_CAP: usize = 4 << 20;
const DIFF_CAP: usize = 1 << 20;
const SMALL_CAP: usize = 64 << 10;
const MAX_LINES: usize = 10_000;
const MAX_ENTRIES: usize = 2_000;
const BINARY_PROBE: usize = 8_000;

/// Git reads bypass the writer; review persistence uses the normal runtime lock.
pub fn is_changes_request(bytes: &[u8]) -> bool {
    serde_json::from_slice::<Value>(bytes)
        .ok()
        .and_then(|value| {
            value
                .get("method")?
                .as_str()
                .map(|method| METHODS.contains(&method))
        })
        .unwrap_or(false)
}

/// Validate and answer one `changes.*` request with the runtime envelope.
pub fn handle_request(data_root: Option<&Path>, bytes: &[u8]) -> Value {
    let request = match crate::envelope(bytes, |method, has_params| {
        has_params && METHODS.contains(&method)
    }) {
        Ok(request) => request,
        Err(reply) => return reply,
    };
    let params = request.params.unwrap_or(Value::Null);
    let result = match request.method.as_str() {
        "changes.status" => parse::<Scope>(params).and_then(|scope| {
            Ok(match resolve(data_root, &scope)? {
                Some(root) => status(&root),
                None => json!({"state": "folderUnavailable"}),
            })
        }),
        _ => parse::<DiffParams>(params).and_then(|p| {
            let scope = Scope {
                workspace_id: p.workspace_id.clone(),
                canvas_id: p.canvas_id.clone(),
                project_id: p.project_id.clone(),
            };
            Ok(json!({"diff": match resolve(data_root, &scope)? {
                Some(root) => diff(&root, &p)?,
                None => json!({"kind": "folderUnavailable"}),
            }}))
        }),
    };
    match result {
        Ok(result) => json!({ "protocolVersion": 1, "id": request.id, "result": result }),
        Err(failure) => crate::error(Some(&request.id), failure.code, &failure.message),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Scope {
    workspace_id: String,
    canvas_id: String,
    project_id: String,
}

#[derive(Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Section {
    Staged,
    Unstaged,
    Untracked,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiffParams {
    workspace_id: String,
    canvas_id: String,
    project_id: String,
    section: Section,
    path: String,
    #[serde(default)]
    orig_path: Option<String>,
}

fn invalid(message: &str) -> RuntimeError {
    RuntimeError::new("INVALID_PARAMS", message)
}

fn parse<T: serde::de::DeserializeOwned>(params: Value) -> Result<T, RuntimeError> {
    serde_json::from_value(params).map_err(|error| {
        RuntimeError::new("INVALID_PARAMS", format!("Invalid parameters: {error}."))
    })
}

/// Read the saved project root for a project that has a Changes tile.
/// `Ok(None)` means the folder is gone or no longer a directory.
fn resolve(data_root: Option<&Path>, scope: &Scope) -> Result<Option<PathBuf>, RuntimeError> {
    if ![&scope.workspace_id, &scope.canvas_id, &scope.project_id]
        .into_iter()
        .all(|value| is_id(value))
    {
        return Err(invalid(
            "Workspace, canvas, and project IDs must be lowercase UUIDs.",
        ));
    }
    let data_root = data_root.ok_or_else(|| {
        RuntimeError::new("STORAGE_ERROR", "No backend data directory is available.")
    })?;
    let database = data_root
        .join("workspaces")
        .join(&scope.workspace_id)
        .join("workspace.sqlite3");
    let conn = Connection::open_with_flags(
        database,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.busy_timeout(Duration::from_millis(200))?;
    let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let application: i64 = conn.pragma_query_value(None, "application_id", |row| row.get(0))?;
    if application != crate::store::APPLICATION_ID || version != crate::STORAGE_VERSION {
        return Err(RuntimeError::new(
            "UNSUPPORTED_STORAGE",
            "Open this workspace with the current backend before reading its changes.",
        ));
    }
    let root: String = conn
        .query_row(
            "SELECT g.root FROM project_group g
            JOIN changes_tile c ON c.project_id = g.id AND c.canvas_id = g.canvas_id
            WHERE g.id = ?1 AND g.canvas_id = ?2 AND EXISTS(SELECT 1 FROM workspace WHERE id = ?3)",
            (&scope.project_id, &scope.canvas_id, &scope.workspace_id),
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| {
            RuntimeError::new(
                "SCOPE_DENIED",
                "This project has no Changes tile on the named workspace and canvas.",
            )
        })?;
    Ok(Path::new(&root)
        .canonicalize()
        .ok()
        .filter(|path| path.is_dir()))
}

struct GitOutput {
    code: Option<i32>,
    stdout: Vec<u8>,
    stderr: String,
    overflow: bool,
}

enum Unavailable {
    NotRepository,
    GitMissing,
    Failed(String),
}

const GIT_MISSING: &str =
    "Git is not installed or not on the backend's PATH. Install Git, then press Refresh.";

/// Run Git with fixed global options, a byte cap on stdout, and a deadline.
fn git(
    cwd: &Path,
    args: &[OsString],
    cap: usize,
    deadline: Instant,
) -> Result<GitOutput, Unavailable> {
    let mut command = Command::new("git");
    command
        .args([
            "--no-pager",
            "--no-optional-locks",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.quotePath=false",
            "-c",
            "color.ui=never",
            "-c",
            "diff.noprefix=false",
            "-c",
            "diff.mnemonicPrefix=false",
            "-c",
            "diff.relative=false",
        ])
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Inherited GIT_DIR, GIT_INDEX_FILE, and similar must not redirect the read.
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("GIT_") {
            command.env_remove(key);
        }
    }
    command
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_PAGER", "cat")
        .env("PAGER", "cat")
        .env("LC_ALL", "C");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            Unavailable::GitMissing
        } else {
            Unavailable::Failed(format!("Cannot run Git: {error}."))
        }
    })?;
    let (Some(mut stdout), Some(mut stderr)) = (child.stdout.take(), child.stderr.take()) else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(Unavailable::Failed("Cannot read Git output.".into()));
    };
    let out = std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = (&mut stdout).take(cap as u64 + 1).read_to_end(&mut buffer);
        buffer
    });
    let err = std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = (&mut stderr)
            .take(SMALL_CAP as u64)
            .read_to_end(&mut buffer);
        let _ = std::io::copy(&mut stderr, &mut std::io::sink());
        String::from_utf8_lossy(&buffer).into_owned()
    });
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(5)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(Unavailable::Failed(
                    "Git took longer than 10 seconds and was stopped. Press Refresh to retry."
                        .into(),
                ));
            }
            Err(error) => return Err(Unavailable::Failed(format!("Cannot run Git: {error}."))),
        }
    };
    let stdout = out.join().unwrap_or_default();
    let stderr = err.join().unwrap_or_default();
    Ok(GitOutput {
        code: status.code(),
        overflow: stdout.len() > cap,
        stdout,
        stderr,
    })
}

fn args<const N: usize>(values: [&str; N]) -> Vec<OsString> {
    values.into_iter().map(OsString::from).collect()
}

fn pathspec(path: &str) -> OsString {
    OsString::from(format!(":(top,literal){path}"))
}

fn failure(output: &GitOutput) -> Unavailable {
    let line: String = output
        .stderr
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("unknown error")
        .chars()
        .filter(|c| !c.is_control())
        .take(200)
        .collect();
    Unavailable::Failed(format!("Git failed: {line}"))
}

/// Canonical work-tree root and the project's repo-relative prefix (`""` or `dir/`).
fn repository(root: &Path, deadline: Instant) -> Result<(PathBuf, String), Unavailable> {
    let output = git(
        root,
        &args([
            "rev-parse",
            "--is-inside-work-tree",
            "--show-toplevel",
            "--show-prefix",
        ]),
        SMALL_CAP,
        deadline,
    )?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    if output.stderr.contains("dubious ownership") {
        return Err(Unavailable::Failed("Git refuses this folder because another user owns it. Fix its ownership or add it to safe.directory in a terminal, then press Refresh.".into()));
    }
    if output.code == Some(128)
        && (output.stderr.contains("not a git repository")
            || output.stderr.contains("must be run in a work tree")
            || stdout.lines().next() == Some("false"))
    {
        return Err(Unavailable::NotRepository);
    }
    if output.code != Some(0) || output.overflow {
        return Err(failure(&output));
    }
    let text = stdout.strip_suffix('\n').unwrap_or(&stdout);
    let lines: Vec<&str> = text.split('\n').collect();
    let unexpected = || Unavailable::Failed("Git returned unexpected output.".into());
    let [inside, top, prefix] = lines.as_slice() else {
        return Err(unexpected());
    };
    if *inside != "true" {
        return Err(Unavailable::NotRepository);
    }
    let top = Path::new(top).canonicalize().map_err(|_| unexpected())?;
    if !root.starts_with(&top) {
        return Err(unexpected());
    }
    Ok((top, (*prefix).to_owned()))
}

fn status(root: &Path) -> Value {
    let deadline = Instant::now() + TIMEOUT;
    let unavailable = |state: Unavailable| match state {
        Unavailable::NotRepository => json!({"state": "notRepository"}),
        Unavailable::GitMissing => json!({"state": "gitUnavailable", "message": GIT_MISSING}),
        Unavailable::Failed(message) => json!({"state": "failed", "message": message}),
    };
    let (top, prefix) = match repository(root, deadline) {
        Ok(found) => found,
        Err(state) => return unavailable(state),
    };
    let mut argv = args([
        "status",
        "--porcelain=v2",
        "--branch",
        "-z",
        "--untracked-files=all",
        "--ignore-submodules=dirty",
    ]);
    if !prefix.is_empty() {
        argv.push("--".into());
        argv.push(pathspec(&prefix));
    }
    let output = match git(&top, &argv, STATUS_CAP, deadline) {
        Ok(output) if output.code == Some(0) || output.overflow => output,
        Ok(output) => return unavailable(failure(&output)),
        Err(state) => return unavailable(state),
    };
    let parsed = parse_status(&output.stdout);
    let truncated = output.overflow || parsed.entries.len() > MAX_ENTRIES;
    let entries: Vec<Value> = parsed
        .entries
        .into_iter()
        .take(MAX_ENTRIES)
        .map(|entry| {
            json!({"section": entry.section, "status": entry.status,
            "path": entry.path, "origPath": entry.orig_path})
        })
        .collect();
    json!({"state": "ready", "branch": parsed.branch, "prefix": prefix,
        "entries": entries, "truncated": truncated})
}

#[derive(Debug, PartialEq)]
struct Entry {
    section: &'static str,
    status: String,
    path: String,
    orig_path: Option<String>,
}

#[derive(Debug, PartialEq)]
struct Status {
    branch: Option<String>,
    entries: Vec<Entry>,
}

/// Parse `git status --porcelain=v2 --branch -z`. A trailing partial record is dropped.
fn parse_status(bytes: &[u8]) -> Status {
    let complete = &bytes[..bytes.iter().rposition(|b| *b == 0).map_or(0, |end| end + 1)];
    let mut records = complete
        .split(|b| *b == 0)
        .filter(|record| !record.is_empty())
        .map(|record| String::from_utf8_lossy(record).into_owned());
    let mut branch = None;
    let mut entries = Vec::new();
    let entry = |section, status: char, path: &str, orig_path| Entry {
        section,
        status: status.to_string(),
        path: path.to_owned(),
        orig_path,
    };
    while let Some(record) = records.next() {
        // `1`/`2` records: X is the staged side, Y the unstaged side.
        let (xy, path, orig) = if record.starts_with("1 ") {
            let parts: Vec<&str> = record.splitn(9, ' ').collect();
            if parts.len() != 9 {
                continue;
            }
            (parts[1], parts[8], None)
        } else if record.starts_with("2 ") {
            // The original path is the following NUL-terminated record.
            let Some(orig) = records.next() else { break };
            let parts: Vec<&str> = record.splitn(10, ' ').collect();
            if parts.len() != 10 {
                continue;
            }
            (parts[1], parts[9], Some(orig))
        } else {
            if let Some(head) = record.strip_prefix("# branch.head ") {
                branch = Some(head.to_owned());
            } else if record.starts_with("u ") {
                let parts: Vec<&str> = record.splitn(11, ' ').collect();
                if parts.len() == 11 {
                    entries.push(entry("unstaged", '!', parts[10], None));
                }
            } else if let Some(path) = record.strip_prefix("? ") {
                entries.push(entry("untracked", '?', path, None));
            }
            continue;
        };
        let mut letters = xy.chars();
        let (x, y) = (letters.next().unwrap_or('.'), letters.next().unwrap_or('.'));
        if x != '.' {
            entries.push(entry("staged", x, path, orig));
        }
        if y != '.' {
            entries.push(entry("unstaged", y, path, None));
        }
    }
    let order = |section: &str| match section {
        "staged" => 0,
        "unstaged" => 1,
        _ => 2,
    };
    entries.sort_by(|a, b| {
        order(a.section)
            .cmp(&order(b.section))
            .then_with(|| a.path.as_bytes().cmp(b.path.as_bytes()))
    });
    Status { branch, entries }
}

/// A repo-relative path must stay inside the project prefix and outside `.git`.
fn check_path(path: &str, prefix: &str) -> Result<(), RuntimeError> {
    let denied = || RuntimeError::new("SCOPE_DENIED", "This path is outside the project folder.");
    if path.is_empty() || path.len() > 4096 || path.contains('\0') || path.starts_with('/') {
        return Err(denied());
    }
    if path.split('/').any(|part| {
        part.is_empty() || part == "." || part == ".." || part.eq_ignore_ascii_case(".git")
    }) {
        return Err(denied());
    }
    if !path.starts_with(prefix) {
        return Err(denied());
    }
    Ok(())
}

fn diff(root: &Path, p: &DiffParams) -> Result<Value, RuntimeError> {
    let deadline = Instant::now() + TIMEOUT;
    let unavailable = |state: Unavailable| match state {
        Unavailable::NotRepository => json!({"kind": "notRepository"}),
        Unavailable::GitMissing => json!({"kind": "gitUnavailable", "message": GIT_MISSING}),
        Unavailable::Failed(message) => json!({"kind": "failed", "message": message}),
    };
    let (top, prefix) = match repository(root, deadline) {
        Ok(found) => found,
        Err(state) => return Ok(unavailable(state)),
    };
    check_path(&p.path, &prefix)?;
    if let Some(orig) = &p.orig_path {
        if p.section != Section::Staged {
            return Err(invalid("origPath is only valid for staged renames."));
        }
        check_path(orig, &prefix)?;
    }
    let mut argv = match p.section {
        Section::Untracked => {
            return Ok(untracked(&top, &p.path, deadline).unwrap_or_else(unavailable))
        }
        Section::Staged => {
            let head = git(
                &top,
                &args(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]),
                SMALL_CAP,
                deadline,
            );
            let base = match head {
                Ok(output) if output.code == Some(0) => "HEAD".to_owned(),
                Ok(_) => match empty_tree(&top, deadline) {
                    Ok(tree) => tree,
                    Err(state) => return Ok(unavailable(state)),
                },
                Err(state) => return Ok(unavailable(state)),
            };
            let mut argv = args([
                "diff-index",
                "--cached",
                "-p",
                "-M",
                "--no-color",
                "--no-ext-diff",
                "--no-textconv",
                "-U3",
                "--src-prefix=a/",
                "--dst-prefix=b/",
            ]);
            argv.push(base.into());
            argv
        }
        Section::Unstaged => args([
            "diff-files",
            "-p",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "-U3",
            "--src-prefix=a/",
            "--dst-prefix=b/",
        ]),
    };
    argv.push("--".into());
    argv.push(pathspec(&p.path));
    if let Some(orig) = &p.orig_path {
        argv.push(pathspec(orig));
    }
    Ok(match git(&top, &argv, DIFF_CAP, deadline) {
        Ok(output) if output.overflow => json!({"kind": "tooLarge"}),
        Ok(output) if output.code == Some(0) => parse_diff(&output.stdout),
        Ok(output) => unavailable(failure(&output)),
        Err(state) => unavailable(state),
    })
}

/// The repository's empty tree object id, computed without writing objects.
fn empty_tree(top: &Path, deadline: Instant) -> Result<String, Unavailable> {
    let output = git(
        top,
        &args(["hash-object", "-t", "tree", "--stdin"]),
        SMALL_CAP,
        deadline,
    )?;
    let id = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if output.code == Some(0)
        && (id.len() == 40 || id.len() == 64)
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        Ok(id)
    } else {
        Err(Unavailable::Failed(
            "Git returned unexpected output.".into(),
        ))
    }
}

/// Show a Git-confirmed untracked file as one all-added hunk, without following links.
fn untracked(top: &Path, path: &str, deadline: Instant) -> Result<Value, Unavailable> {
    let mut argv = args(["ls-files", "--others", "--exclude-standard", "-z", "--"]);
    argv.push(pathspec(path));
    let listed = git(top, &argv, SMALL_CAP, deadline)?;
    if listed.code != Some(0) || listed.stdout != [path.as_bytes(), b"\0"].concat() {
        return Ok(json!({"kind": "missing"}));
    }
    let full = top.join(path);
    let contained = full
        .parent()
        .and_then(|parent| parent.canonicalize().ok())
        .is_some_and(|parent| parent.starts_with(top));
    if !contained {
        return Ok(json!({"kind": "missing"}));
    }
    let Ok(metadata) = std::fs::symlink_metadata(&full) else {
        return Ok(json!({"kind": "missing"}));
    };
    if metadata.file_type().is_symlink() {
        let target = std::fs::read_link(&full)
            .map(|target| target.to_string_lossy().into_owned())
            .unwrap_or_default();
        return Ok(
            json!({"kind": "text", "notes": ["Symbolic link"], "hunks": [{
            "header": "@@ -0,0 +1 @@", "oldStart": 0, "oldLines": 0, "newStart": 1, "newLines": 1,
            "lines": [["+", target, true]]}]}),
        );
    }
    if !metadata.is_file() {
        return Ok(json!({"kind": "empty", "notes": ["Not a regular file"]}));
    }
    if metadata.len() > DIFF_CAP as u64 {
        return Ok(json!({"kind": "tooLarge"}));
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let Ok(file) = options.open(&full) else {
        return Ok(json!({"kind": "missing"}));
    };
    let mut bytes = Vec::new();
    if file
        .take(DIFF_CAP as u64 + 1)
        .read_to_end(&mut bytes)
        .is_err()
    {
        return Err(Unavailable::Failed("Cannot read this file.".into()));
    }
    Ok(synthesize(&bytes))
}

fn synthesize(bytes: &[u8]) -> Value {
    if bytes.len() > DIFF_CAP {
        return json!({"kind": "tooLarge"});
    }
    if bytes[..bytes.len().min(BINARY_PROBE)].contains(&0) {
        return json!({"kind": "binary", "notes": []});
    }
    if bytes.is_empty() {
        return json!({"kind": "empty", "notes": ["Empty file"]});
    }
    let body = bytes.strip_suffix(b"\n").unwrap_or(bytes);
    let mut lines: Vec<Value> = body
        .split(|b| *b == b'\n')
        .map(|line| json!(["+", String::from_utf8_lossy(line), false]))
        .collect();
    if lines.len() > MAX_LINES {
        return json!({"kind": "tooLarge"});
    }
    if !bytes.ends_with(b"\n") {
        if let Some(last) = lines.last_mut() {
            last[2] = json!(true);
        }
    }
    let count = lines.len();
    json!({"kind": "text", "notes": ["New untracked file"], "hunks": [{
        "header": format!("@@ -0,0 +1,{count} @@"), "oldStart": 0, "oldLines": 0,
        "newStart": 1, "newLines": count, "lines": lines}]})
}

/// `-a[,b]` or `+c[,d]`; a missing count means 1.
fn range(field: &str) -> Option<(u64, u64)> {
    let field = &field[1..];
    let (start, count) = field.split_once(',').unwrap_or((field, "1"));
    Some((start.parse().ok()?, count.parse().ok()?))
}

/// Parse a unified patch into hunks with old/new start lines and tagged lines.
fn parse_diff(bytes: &[u8]) -> Value {
    let mut notes: Vec<String> = Vec::new();
    let mut hunks: Vec<Value> = Vec::new();
    let mut binary = false;
    let mut total = 0usize;
    // Lines still expected in the current hunk (old, new).
    let mut remaining = (0u64, 0u64);
    let mut old_mode = String::new();
    let body = bytes.strip_suffix(b"\n").unwrap_or(bytes);
    for raw in body.split(|b| *b == b'\n') {
        let line = String::from_utf8_lossy(raw);
        if remaining != (0, 0) {
            let (tag, text) = match raw.first() {
                Some(b'+') => ("+", &line[1..]),
                Some(b'-') => ("-", &line[1..]),
                Some(b' ') => (" ", &line[1..]),
                None => (" ", ""),
                Some(b'\\') => {
                    mark_no_newline(&mut hunks);
                    continue;
                }
                _ => {
                    remaining = (0, 0);
                    ("", "")
                }
            };
            if !tag.is_empty() {
                if tag != "+" {
                    remaining.0 = remaining.0.saturating_sub(1);
                }
                if tag != "-" {
                    remaining.1 = remaining.1.saturating_sub(1);
                }
                total += 1;
                if total > MAX_LINES {
                    return json!({"kind": "tooLarge"});
                }
                if let Some(lines) = hunks
                    .last_mut()
                    .and_then(|hunk| hunk["lines"].as_array_mut())
                {
                    lines.push(json!([tag, text, false]));
                }
                continue;
            }
        }
        if raw.starts_with(b"\\") {
            mark_no_newline(&mut hunks);
        } else if line.starts_with("@@ ") {
            let mut fields = line.split(' ');
            let (old, new) = (fields.nth(1).and_then(range), fields.next().and_then(range));
            if let (Some(old), Some(new)) = (old, new) {
                remaining = (old.1, new.1);
                hunks.push(json!({"header": line, "oldStart": old.0, "oldLines": old.1,
                    "newStart": new.0, "newLines": new.1, "lines": []}));
            }
        } else if line.starts_with("new file mode") {
            notes.push("New file".into());
        } else if line.starts_with("deleted file mode") {
            notes.push("Deleted file".into());
        } else if let Some(mode) = line.strip_prefix("old mode ") {
            old_mode = mode.to_owned();
        } else if let Some(mode) = line.strip_prefix("new mode ") {
            notes.push(format!("Mode changed {old_mode} → {mode}"));
        } else if let Some(from) = line.strip_prefix("rename from ") {
            notes.push(format!("Renamed from {from}"));
        } else if line.starts_with("Binary files ") || line.starts_with("GIT binary patch") {
            binary = true;
        } else if line.starts_with("* Unmerged path") || line.starts_with("diff --cc ") {
            notes.push("Unmerged; resolve the conflict in a terminal".into());
        }
    }
    notes.dedup();
    notes.truncate(8);
    if binary {
        json!({"kind": "binary", "notes": notes})
    } else if hunks.is_empty() {
        if notes.is_empty() {
            notes.push("No content changes".into());
        }
        json!({"kind": "empty", "notes": notes})
    } else {
        json!({"kind": "text", "notes": notes, "hunks": hunks})
    }
}

fn mark_no_newline(hunks: &mut [Value]) {
    if let Some(last) = hunks
        .last_mut()
        .and_then(|hunk| hunk["lines"].as_array_mut())
        .and_then(|lines| lines.last_mut())
    {
        last[2] = json!(true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(target_os = "linux")]
    fn git_children_are_not_taken_by_the_orphan_reaper() {
        // Under PID 1 the supervisor starts a reaper; it must leave Git's
        // exit status to the try_wait loop that owns the child.
        let _supervisor = crate::sessions::SessionSupervisor::new().unwrap();
        let root = tempfile::tempdir().unwrap();
        for _ in 0..200 {
            let deadline = Instant::now() + Duration::from_secs(10);
            if let Err(Unavailable::Failed(message)) =
                git(root.path(), &["--version".into()], 1024, deadline)
            {
                panic!("{message}");
            }
        }
    }

    #[test]
    fn porcelain_v2_splits_sections_and_keeps_both_sides_of_mm() {
        let raw = b"# branch.oid 0123\0# branch.head main\0\
1 MM N... 100644 100644 100644 aaa bbb src/both.ts\0\
1 A. N... 000000 100644 100644 000 ccc src/new file.ts\0\
2 R. N... 100644 100644 100644 ddd ddd R100 src/renamed.ts\0src/old.ts\0\
1 .M N... 100644 100644 100644 eee eee README.md\0\
u UU N... 100644 100644 100644 100644 f1 f2 f3 conflict.txt\0\
? notes/todo.md\0? partial";
        let status = parse_status(raw);
        assert_eq!(status.branch.as_deref(), Some("main"));
        let summary: Vec<(&str, &str, &str, Option<&str>)> = status
            .entries
            .iter()
            .map(|e| {
                (
                    e.section,
                    e.status.as_str(),
                    e.path.as_str(),
                    e.orig_path.as_deref(),
                )
            })
            .collect();
        assert_eq!(
            summary,
            [
                ("staged", "M", "src/both.ts", None),
                ("staged", "A", "src/new file.ts", None),
                ("staged", "R", "src/renamed.ts", Some("src/old.ts")),
                ("unstaged", "M", "README.md", None),
                ("unstaged", "!", "conflict.txt", None),
                ("unstaged", "M", "src/both.ts", None),
                ("untracked", "?", "notes/todo.md", None),
            ]
        );
    }

    #[test]
    fn hunks_carry_line_starts_tags_and_no_newline_markers() {
        let patch = b"diff --git a/src/a.ts b/src/a.ts\nindex 1..2 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n\
@@ -1,3 +1,4 @@ fn x\n one\n-two\n+TWO\n+three\n\n@@ -40 +41,2 @@\n-last\n\\ No newline at end of file\n+last\n+more\n";
        let diff = parse_diff(patch);
        assert_eq!(diff["kind"], "text");
        let hunks = diff["hunks"].as_array().unwrap();
        assert_eq!(hunks.len(), 2);
        assert_eq!(hunks[0]["header"], "@@ -1,3 +1,4 @@ fn x");
        assert_eq!(
            (hunks[0]["oldStart"].as_u64(), hunks[0]["newStart"].as_u64()),
            (Some(1), Some(1))
        );
        assert_eq!(
            hunks[0]["lines"],
            json!([
                [" ", "one", false],
                ["-", "two", false],
                ["+", "TWO", false],
                ["+", "three", false],
                [" ", "", false]
            ])
        );
        assert_eq!(
            (hunks[1]["oldLines"].as_u64(), hunks[1]["newLines"].as_u64()),
            (Some(1), Some(2))
        );
        assert_eq!(
            hunks[1]["lines"],
            json!([
                ["-", "last", true],
                ["+", "last", false],
                ["+", "more", false]
            ])
        );
        assert_eq!(
            parse_diff(b"diff --git a/x b/x\nBinary files a/x and b/x differ\n")["kind"],
            "binary"
        );
        assert_eq!(parse_diff(b"")["kind"], "empty");
        let mode = parse_diff(b"diff --git a/x b/x\nold mode 100644\nnew mode 100755\n");
        assert_eq!(mode["notes"], json!(["Mode changed 100644 → 100755"]));
    }

    #[test]
    fn untracked_files_become_one_added_hunk() {
        let text = synthesize(b"a\nb");
        assert_eq!(text["hunks"][0]["header"], "@@ -0,0 +1,2 @@");
        assert_eq!(
            text["hunks"][0]["lines"],
            json!([["+", "a", false], ["+", "b", true]])
        );
        assert_eq!(synthesize(b"bin\0ary")["kind"], "binary");
        assert_eq!(synthesize(b"")["kind"], "empty");
        assert_eq!(synthesize(&vec![b'x'; DIFF_CAP + 1])["kind"], "tooLarge");
    }

    #[test]
    fn paths_stay_inside_the_project_prefix() {
        assert!(check_path("app/src/main.ts", "app/").is_ok());
        for path in [
            "",
            "/etc/passwd",
            "app/../secret",
            "app/.git/config",
            "other/x",
            "app//x",
            "app/./x",
        ] {
            assert_eq!(
                check_path(path, "app/").unwrap_err().code,
                "SCOPE_DENIED",
                "{path}"
            );
        }
    }
}
