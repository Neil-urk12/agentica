//! Workspace storage owned by the shared runtime.

use std::{
    fs::{self, File, OpenOptions, TryLockError},
    io,
    path::{Path, PathBuf},
    time::Duration,
};

use rusqlite::{Connection, OpenFlags, OptionalExtension, Transaction, TransactionBehavior};

const LOCK_FILE: &str = "writer.lock";
const DATABASE_FILE: &str = "workspace.sqlite3";
/// `AGNT`: identifies Agentica workspace databases.
pub(crate) const APPLICATION_ID: i64 = 0x4147_4e54;
/// Ordered migrations; index + 1 is the resulting `user_version`.
const MIGRATIONS: &[&str] = &[
    include_str!("schema_v1.sql"),
    include_str!("schema_v2.sql"),
    include_str!("schema_v3.sql"),
    include_str!("schema_v4.sql"),
    include_str!("schema_v5.sql"),
    include_str!("schema_v6.sql"),
    include_str!("schema_v7.sql"),
    include_str!("schema_v8.sql"),
    include_str!("schema_v9.sql"),
    include_str!("schema_v10.sql"),
    include_str!("schema_v11.sql"),
    include_str!("schema_v12.sql"),
    include_str!("schema_v13.sql"),
    include_str!("schema_v14.sql"),
    include_str!("schema_v15.sql"),
];
pub const STORAGE_VERSION: i64 = MIGRATIONS.len() as i64;

/// A runtime error reported to clients with a stable code.
#[derive(Debug)]
pub struct RuntimeError {
    pub code: &'static str,
    pub message: String,
}

impl std::fmt::Display for RuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}
impl std::error::Error for RuntimeError {}

impl RuntimeError {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl From<io::Error> for RuntimeError {
    fn from(error: io::Error) -> Self {
        Self::new(
            "STORAGE_ERROR",
            format!("Cannot access workspace storage: {error}. Nothing was saved; check the data directory and retry."),
        )
    }
}

/// `AGENTICA_DATA_DIR`, or the OS data directory joined with `agentica`.
pub fn default_data_root() -> Option<PathBuf> {
    match std::env::var_os("AGENTICA_DATA_DIR") {
        Some(path) if !path.is_empty() => Some(PathBuf::from(path)),
        _ => dirs::data_dir().map(|path| path.join("agentica")),
    }
}

/// Lowercase hyphenated UUID, the only accepted form of client-supplied IDs.
pub(crate) fn is_id(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
            }
        })
}

/// Random version 4 UUID.
pub(crate) fn new_id() -> Result<String, RuntimeError> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|error| io::Error::other(error.to_string()))?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    ))
}

/// Canonical `<data root>/workspaces`, created when first needed.
pub(crate) fn workspaces_dir(data_root: Option<&Path>) -> Result<PathBuf, RuntimeError> {
    let root = data_root.ok_or_else(|| {
        RuntimeError::new(
            "STORAGE_ERROR",
            "No application data directory is available. Set AGENTICA_DATA_DIR to a writable directory.",
        )
    })?;
    let dir = root.join("workspaces");
    fs::create_dir_all(&dir)?;
    Ok(dir.canonicalize()?)
}

/// A held workspace writer lock, released on drop.
#[derive(Debug)]
pub(crate) struct WorkspaceLock(File);

impl Drop for WorkspaceLock {
    fn drop(&mut self) {
        // The lock belongs to the open file, which a process spawned by any
        // thread shares until it execs; closing alone would keep it held.
        let _ = self.0.unlock();
    }
}

/// Take the workspace's exclusive writer lock without blocking. The OS lock is
/// tied to the file, so path aliases contend; it is released when the returned
/// handle is dropped or the process ends.
pub(crate) fn lock_workspace(dir: &Path, id: &str) -> Result<WorkspaceLock, RuntimeError> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(dir.join(LOCK_FILE))?;
    match file.try_lock() {
        Ok(()) => Ok(WorkspaceLock(file)),
        Err(TryLockError::WouldBlock) => Err(RuntimeError::new(
            "WORKSPACE_LOCKED",
            format!("Workspace {id} is already open in another Agentica window or backend. Close it there, then retry."),
        )),
        Err(TryLockError::Error(error)) => Err(error.into()),
    }
}

impl From<rusqlite::Error> for RuntimeError {
    fn from(error: rusqlite::Error) -> Self {
        Self::new(
            "STORAGE_ERROR",
            format!("Workspace storage failed: {error}. The change was not saved; keep your edits and retry."),
        )
    }
}

fn unsupported(message: String) -> RuntimeError {
    RuntimeError::new(
        "UNSUPPORTED_STORAGE",
        format!("{message} The workspace was not modified."),
    )
}

/// Open a connection with foreign keys and durable transaction commits.
fn connect(path: &Path, create: bool) -> rusqlite::Result<Connection> {
    let mut flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    if create {
        flags |= OpenFlags::SQLITE_OPEN_CREATE;
    }
    let conn = Connection::open_with_flags(path, flags)?;
    // Listing readers may briefly hold shared locks.
    conn.busy_timeout(Duration::from_secs(2))?;
    // Foreign keys stay off until migrations finish: storage rebuilds drop
    // parent tables, which SQLite rejects while they are enforced. `create`
    // and `open` re-enable them once the schema is current.
    conn.pragma_update(None, "foreign_keys", false)?;
    conn.pragma_update(None, "synchronous", "FULL")?;
    Ok(conn)
}

/// Apply `migrations[from..]` in the caller's transaction; the caller commits.
fn migrate(tx: &Transaction, from: i64, migrations: &[&str]) -> rusqlite::Result<()> {
    for sql in migrations.iter().skip(from as usize) {
        tx.execute_batch(sql)?;
    }
    if from == 0 {
        tx.pragma_update(None, "application_id", APPLICATION_ID)?;
    }
    tx.pragma_update(None, "user_version", migrations.len() as i64)
}

fn header(conn: &Connection) -> rusqlite::Result<(i64, i64)> {
    Ok((
        conn.pragma_query_value(None, "application_id", |row| row.get(0))?,
        conn.pragma_query_value(None, "user_version", |row| row.get(0))?,
    ))
}

/// An open workspace. Fields drop in order, so the connection closes before
/// the writer lock is released.
pub(crate) struct Workspace {
    pub id: String,
    pub conn: Connection,
    _lock: WorkspaceLock,
}

impl Workspace {
    /// Create a workspace: schema and workspace row commit together.
    pub(crate) fn create(data_root: Option<&Path>, name: &str) -> Result<Self, RuntimeError> {
        let id = new_id()?;
        let dir = workspaces_dir(data_root)?.join(&id);
        fs::create_dir(&dir)?;
        let lock = lock_workspace(&dir, &id)?;
        let mut conn = connect(&dir.join(DATABASE_FILE), true)?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        migrate(&tx, 0, MIGRATIONS)?;
        tx.execute(
            "INSERT INTO workspace (id, name) VALUES (?1, ?2)",
            (&id, name),
        )?;
        tx.commit()?;
        conn.pragma_update(None, "foreign_keys", true)?;
        Ok(Self {
            id,
            conn,
            _lock: lock,
        })
    }

    /// Lock, validate, and migrate an existing workspace. Unsupported or
    /// incomplete storage is rejected before any change.
    pub(crate) fn open(data_root: Option<&Path>, id: &str) -> Result<Self, RuntimeError> {
        let dir = workspaces_dir(data_root)?.join(id);
        let database = dir.join(DATABASE_FILE);
        if !database.is_file() {
            return Err(RuntimeError::new("NOT_FOUND", "Workspace not found."));
        }
        let lock = lock_workspace(&dir, id)?;
        let mut conn = connect(&database, false)?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (application_id, version) = header(&tx)?;
        if application_id == 0 && version == 0 {
            return Err(RuntimeError::new(
                "NOT_FOUND",
                "This workspace was not fully created and cannot be opened.",
            ));
        }
        if application_id != APPLICATION_ID {
            return Err(unsupported(
                "This file is not an Agentica workspace database.".to_owned(),
            ));
        }
        if version > STORAGE_VERSION {
            return Err(unsupported(format!(
                "Workspace storage version {version} is newer than this Agentica build supports ({STORAGE_VERSION}). Update Agentica to open it."
            )));
        }
        if version < STORAGE_VERSION {
            migrate(&tx, version, MIGRATIONS)?;
        }
        let stored: Option<String> = tx
            .query_row("SELECT id FROM workspace", [], |row| row.get(0))
            .optional()?;
        if stored.as_deref() != Some(id) {
            return Err(unsupported(
                "The workspace record is missing or does not match its directory.".to_owned(),
            ));
        }
        tx.commit()?;
        conn.pragma_update(None, "foreign_keys", true)?;
        Ok(Self {
            id: id.to_owned(),
            conn,
            _lock: lock,
        })
    }

    /// Turns still generating when an earlier process stopped can never finish.
    pub(crate) fn interrupt_generating(&self) -> Result<(), RuntimeError> {
        self.conn.execute("UPDATE conversation_turn SET status = 'interrupted', error = 'Generation was interrupted. Retry explicitly.' WHERE status = 'generating'", [])?;
        Ok(())
    }
}

/// A crashed write leaves a journal that only a writer can roll back.
fn needs_rollback(error: &rusqlite::Error) -> bool {
    matches!(error, rusqlite::Error::SqliteFailure(failure, _)
        if failure.extended_code == rusqlite::ffi::SQLITE_READONLY_ROLLBACK)
}

/// A readable workspace's `(name, canvas count)`.
pub(crate) type WorkspaceSummary = (String, i64);

/// Committed workspaces as `(id, summary)`; the summary is `None`
/// when the workspace cannot be read by this build. Incomplete creations are skipped. Readers
/// never modify storage, except to roll back a crashed write while no writer
/// holds the workspace and to remove restores abandoned by a crash.
pub(crate) fn list_workspaces(
    data_root: Option<&Path>,
) -> Result<Vec<(String, Option<WorkspaceSummary>)>, RuntimeError> {
    let dir = workspaces_dir(data_root)?;
    remove_abandoned_restores(&dir, ABANDONED_RESTORE);
    let mut workspaces = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let Some(id) = entry
            .file_name()
            .to_str()
            .filter(|id| is_id(id))
            .map(str::to_owned)
        else {
            continue;
        };
        let database = entry.path().join(DATABASE_FILE);
        if !database.is_file() {
            continue;
        }
        let read = |conn: Connection| -> rusqlite::Result<Option<Option<WorkspaceSummary>>> {
            conn.busy_timeout(Duration::from_secs(1))?;
            match header(&conn)? {
                (0, 0) => Ok(None),
                (APPLICATION_ID, 1..=STORAGE_VERSION) => Ok(Some(
                    conn.query_row(
                        "SELECT name, (SELECT count(*) FROM canvas) FROM workspace WHERE id = ?1",
                        [&id],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .optional()?,
                )),
                _ => Ok(Some(None)),
            }
        };
        let mut result = Connection::open_with_flags(
            &database,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .and_then(read);
        if result.as_ref().is_err_and(needs_rollback) {
            if let Ok(_lock) = lock_workspace(&entry.path(), &id) {
                result = connect(&database, false).and_then(read);
            }
        }
        match result {
            Ok(None) => {}
            Ok(Some(summary)) => workspaces.push((id, summary)),
            Err(_) => workspaces.push((id, None)),
        }
    }
    workspaces.sort();
    Ok(workspaces)
}

/// Age after which a restore staging directory is treated as abandoned. Far
/// longer than any restore takes, so a restore running in another window is
/// never removed.
const ABANDONED_RESTORE: Duration = Duration::from_secs(60 * 60);

/// Best-effort removal of `.restore-*` directories left by a restore that
/// crashed before it could clean up.
fn remove_abandoned_restores(dir: &Path, older_than: Duration) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let abandoned = entry
            .file_name()
            .to_str()
            .is_some_and(|name| name.starts_with(".restore-"))
            && entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .is_ok_and(|modified| modified.elapsed().is_ok_and(|age| age >= older_than));
        if abandoned {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

/// Delete a workspace's storage. The writer lock is held across the removal,
/// so the workspace must be closed in this and every other runtime. A directory
/// without a committed database is left alone: it is an interrupted creation,
/// not a workspace.
pub(crate) fn delete_workspace(data_root: Option<&Path>, id: &str) -> Result<(), RuntimeError> {
    let not_found = || RuntimeError::new("NOT_FOUND", "Workspace not found.");
    if !is_id(id) {
        return Err(not_found());
    }
    let dir = workspaces_dir(data_root)?.join(id);
    let database = dir.join(DATABASE_FILE);
    if !database.is_file() {
        return Err(not_found());
    }
    let lock = lock_workspace(&dir, id)?;
    // Read-write under the held lock, so a crashed write can be rolled back.
    let conn = connect(&database, false)?;
    match header(&conn)? {
        (0, 0) => return Err(not_found()),
        (APPLICATION_ID, 1..) => {}
        _ => {
            return Err(unsupported(
                "This file is not a committed Agentica workspace database.".to_owned(),
            ));
        }
    }
    let stored: Option<String> = conn
        .query_row("SELECT id FROM workspace", [], |row| row.get(0))
        .optional()?;
    if stored.as_deref() != Some(id) {
        return Err(unsupported(
            "The workspace record is missing or does not match its directory.".to_owned(),
        ));
    }
    drop(conn);
    // Keep the lock pathname intact until another writer can no longer open the database.
    fs::remove_file(&database)?;
    fs::remove_dir_all(&dir)?;
    drop(lock);
    Ok(())
}

/// Write a consistent copy of a committed workspace to `destination`. A
/// separate read-only connection reads it, so the workspace may stay open in
/// any window. The copy is written beside the destination and renamed over it,
/// so a failure never leaves a partial file there.
pub fn backup_workspace(
    data_root: Option<&Path>,
    id: &str,
    destination: &Path,
) -> Result<(), RuntimeError> {
    let not_found = || RuntimeError::new("NOT_FOUND", "Workspace not found.");
    if !is_id(id) {
        return Err(not_found());
    }
    let dir = workspaces_dir(data_root)?.join(id);
    let database = dir.join(DATABASE_FILE);
    if !database.is_file() {
        return Err(not_found());
    }
    let read_only = || {
        let conn = Connection::open_with_flags(
            &database,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.busy_timeout(Duration::from_secs(1))?;
        header(&conn).map(|header| (conn, header))
    };
    let mut opened = read_only();
    let _lock;
    if opened.as_ref().is_err_and(needs_rollback) {
        // Only a writer can roll back a crashed write; an open writer already has.
        _lock = lock_workspace(&dir, id)?;
        opened = connect(&database, false).and_then(|conn| header(&conn).map(|h| (conn, h)));
    }
    let (conn, (application_id, version)) = opened?;
    if application_id != APPLICATION_ID || version < 1 {
        return Err(not_found());
    }
    destination
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| RuntimeError::new("INVALID_REQUEST", "Choose a backup file name."))?;
    let temp = destination.with_file_name(format!(".agentica-{}.partial", new_id()?));
    let target = temp.to_str().ok_or_else(|| {
        RuntimeError::new(
            "INVALID_REQUEST",
            "The backup location must be a Unicode path. Choose another folder.",
        )
    })?;
    let written = conn
        .execute("VACUUM INTO ?1", [target])
        .map_err(RuntimeError::from)
        .and_then(|_| {
            drop(conn);
            fs::rename(&temp, destination).map_err(RuntimeError::from)
        });
    if written.is_err() {
        let _ = fs::remove_file(&temp);
    }
    written
}

fn refused(message: &str) -> RuntimeError {
    RuntimeError::new(
        "UNSUPPORTED_STORAGE",
        format!("{message} No workspace was added."),
    )
}

const NOT_A_BACKUP: &str = "This file is not an Agentica workspace backup.";

/// Reject a staged backup unless it is a committed Agentica workspace that
/// this build supports, has exactly the schema our migrations create for its
/// version, and passes integrity checks. Only pragmas and `sqlite_schema` are
/// read, so no SQL stored in the file runs here, and the schema is compared
/// first so the integrity checks only evaluate objects Agentica creates.
fn validate_backup(conn: &Connection) -> Result<i64, RuntimeError> {
    let damaged = || refused("This backup is damaged and cannot be restored.");
    conn.pragma_update(None, "trusted_schema", false)?;
    let (application_id, version) = header(conn).map_err(|_| refused(NOT_A_BACKUP))?;
    if application_id != APPLICATION_ID || version < 1 {
        return Err(refused(NOT_A_BACKUP));
    }
    if version > STORAGE_VERSION {
        return Err(refused(&format!(
            "Backup storage version {version} is newer than this Agentica build supports ({STORAGE_VERSION}). Update Agentica to restore it."
        )));
    }
    let schema = |conn: &Connection| -> rusqlite::Result<Vec<[Option<String>; 4]>> {
        let mut statement = conn
            .prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name")?;
        let rows = statement
            .query_map([], |row| {
                Ok([row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?])
            })?
            .collect();
        rows
    };
    let mut reference = Connection::open_in_memory()?;
    let tx = reference.transaction()?;
    migrate(&tx, 0, &MIGRATIONS[..version as usize])?;
    tx.commit()?;
    if schema(conn).map_err(|_| damaged())? != schema(&reference)? {
        return Err(refused(
            "This backup contains database objects Agentica does not create.",
        ));
    }
    let integrity: Vec<String> = conn
        .prepare("PRAGMA integrity_check")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| row.get(0))?
                .collect::<Result<_, _>>()
        })
        .map_err(|_| damaged())?;
    if integrity != ["ok"] {
        return Err(damaged());
    }
    let violation = conn
        .prepare("PRAGMA foreign_key_check")
        .and_then(|mut statement| statement.exists([]))
        .map_err(|_| damaged())?;
    if violation {
        return Err(damaged());
    }
    if version >= 15 {
        let missing = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM artifact a LEFT JOIN web_preview_content p ON p.id = a.content_id WHERE a.type = 'web-preview' AND p.id IS NULL)",
            [], |row| row.get::<_, bool>(0),
        ).map_err(|_| damaged())?;
        if missing {
            return Err(damaged());
        }
        let mut statement = conn
            .prepare("SELECT url FROM web_preview_content")
            .map_err(|_| damaged())?;
        let urls = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|_| damaged())?;
        for url in urls {
            if crate::commands::preview_url(&url.map_err(|_| damaged())?, &[]).is_err() {
                return Err(damaged());
            }
        }
    }
    Ok(version)
}

/// Add a validated copy of a backup as a new workspace and return its ID and
/// name. The copy is staged in a hidden directory the listing skips, and only
/// renamed into place once it is valid, migrated, renamed, and has every MCP
/// server turned off, so restoring never starts a configured command.
pub fn restore_workspace(
    data_root: Option<&Path>,
    source: &Path,
) -> Result<(String, String), RuntimeError> {
    let dir = workspaces_dir(data_root)?;
    let id = new_id()?;
    let staging = dir.join(format!(".restore-{id}"));
    fs::create_dir(&staging)?;
    let restored = (|| -> Result<(String, String), RuntimeError> {
        fs::copy(source, staging.join(DATABASE_FILE))?;
        let mut conn =
            connect(&staging.join(DATABASE_FILE), false).map_err(|_| refused(NOT_A_BACKUP))?;
        let version = validate_backup(&conn)?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        migrate(&tx, version, MIGRATIONS)?;
        let original: String = tx
            .query_row("SELECT name FROM workspace", [], |row| row.get(0))
            .optional()?
            .ok_or_else(|| refused("The backup has no workspace record and cannot be restored."))?;
        const SUFFIX: &str = " (restored)";
        let mut name = original.trim().to_owned();
        if name.is_empty() {
            name = "Workspace".to_owned();
        }
        while name.encode_utf16().count() + SUFFIX.encode_utf16().count()
            > crate::commands::MAX_LABEL
        {
            name.pop();
        }
        let name = format!("{}{SUFFIX}", name.trim_end());
        tx.execute("UPDATE workspace SET id = ?1, name = ?2", (&id, &name))?;
        let server_ids: Vec<String> = tx
            .prepare("SELECT id FROM mcp_server")?
            .query_map([], |row| row.get(0))?
            .collect::<Result<_, _>>()?;
        for old_id in server_ids {
            let new_id = new_id()?;
            tx.execute(
                "UPDATE mcp_server SET id = ?1 WHERE id = ?2",
                (&new_id, &old_id),
            )?;
            tx.execute(
                "UPDATE mcp_tool SET server_id = ?1 WHERE server_id = ?2",
                (&new_id, &old_id),
            )?;
        }
        tx.execute("UPDATE mcp_server SET enabled = 0", [])?;
        tx.commit()?;
        drop(conn);
        fs::rename(&staging, dir.join(&id))?;
        Ok((id, name))
    })();
    if restored.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    restored
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader},
        process::{Child, Command, Stdio},
    };

    const HOLDER_ENV: &str = "AGENTICA_TEST_LOCK_HOLDER";

    fn workspace(root: &Path) -> (PathBuf, String) {
        let id = new_id().unwrap();
        let dir = workspaces_dir(Some(root)).unwrap().join(&id);
        fs::create_dir(&dir).unwrap();
        (dir, id)
    }

    fn assert_locked(dir: &Path, id: &str) {
        let error = lock_workspace(dir, id).unwrap_err();
        assert_eq!(error.code, "WORKSPACE_LOCKED");
        assert!(error.message.contains("Close it there"));
    }

    /// Re-run this test binary as a separate process that holds the lock.
    fn spawn_holder(dir: &Path) -> Child {
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "store::tests::lock_holder_process",
                "--nocapture",
            ])
            .env(HOLDER_ENV, dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
        assert!(lines.any(|line| line.unwrap() == "HOLDING"));
        // Keep the pipe open so the child's test harness can finish writing.
        std::thread::spawn(move || lines.for_each(drop));
        child
    }

    #[test]
    fn lock_holder_process() {
        let Some(dir) = std::env::var_os(HOLDER_ENV) else {
            return;
        };
        let _lock = lock_workspace(Path::new(&dir), "holder").unwrap();
        println!("HOLDING");
        // Hold until the parent closes stdin, then exit normally.
        let _ = io::stdin().lines().count();
    }

    #[test]
    fn ids_are_lowercase_uuids() {
        let id = new_id().unwrap();
        assert!(is_id(&id));
        assert_eq!(&id[14..15], "4");
        assert_ne!(id, new_id().unwrap());
        for invalid in [
            "",
            "../../etc",
            "00000000-0000-0000-0000-00000000000",
            "0000000000000000000000000000000000ab",
            "ABCDEF00-0000-4000-8000-000000000000",
            "abcdef00-0000-4000-8000-00000000000g",
        ] {
            assert!(!is_id(invalid), "{invalid}");
        }
    }

    #[test]
    fn a_second_writer_and_path_aliases_are_rejected_until_release() {
        let temp = tempfile::tempdir().unwrap();
        let (dir, id) = workspace(temp.path());
        let held = lock_workspace(&dir, &id).unwrap();
        // Same process, separate handle: a second runtime instance.
        assert_locked(&dir, &id);
        // `..` alias of the data root.
        let alias = temp.path().join("workspaces").join("..");
        assert_locked(&workspaces_dir(Some(&alias)).unwrap().join(&id), &id);
        #[cfg(unix)]
        {
            let link = temp.path().with_extension("alias");
            std::os::unix::fs::symlink(temp.path(), &link).unwrap();
            assert_locked(&link.join("workspaces").join(&id), &id);
            fs::remove_file(link).unwrap();
        }
        drop(held);
        let reacquired = lock_workspace(&dir, &id).unwrap();
        drop(reacquired);
    }

    #[test]
    fn a_release_is_immediate_while_a_spawning_child_shares_the_lock() {
        let temp = tempfile::tempdir().unwrap();
        let (dir, id) = workspace(temp.path());
        let held = lock_workspace(&dir, &id).unwrap();
        // A process spawned by another thread holds a duplicate of the lock
        // file until it execs; a duplicate in this process stands in for it.
        let child_copy = held.0.try_clone().unwrap();
        drop(held);
        drop(lock_workspace(&dir, &id).unwrap());
        drop(child_copy);
    }

    #[test]
    fn locks_contend_across_processes_and_release_on_exit_or_termination() {
        let temp = tempfile::tempdir().unwrap();
        let (dir, id) = workspace(temp.path());

        let mut holder = spawn_holder(&dir);
        assert_locked(&dir, &id);
        drop(holder.stdin.take());
        assert!(holder.wait().unwrap().success());
        drop(lock_workspace(&dir, &id).unwrap());

        let mut holder = spawn_holder(&dir);
        assert_locked(&dir, &id);
        holder.kill().unwrap();
        holder.wait().unwrap();
        drop(lock_workspace(&dir, &id).unwrap());
    }

    #[test]
    fn missing_data_root_is_actionable() {
        let error = workspaces_dir(None).unwrap_err();
        assert_eq!(error.code, "STORAGE_ERROR");
        assert!(error.message.contains("AGENTICA_DATA_DIR"));
    }

    const TORN_WRITE_ENV: &str = "AGENTICA_TEST_TORN_WRITE";

    fn database(root: &Path, id: &str) -> PathBuf {
        root.join("workspaces").join(id).join(DATABASE_FILE)
    }

    fn created(root: &Path, name: &str) -> String {
        Workspace::create(Some(root), name).unwrap().id.clone()
    }

    fn name(workspace: &Workspace) -> String {
        workspace
            .conn
            .query_row("SELECT name FROM workspace", [], |row| row.get(0))
            .unwrap()
    }

    #[test]
    fn workspaces_are_created_versioned_and_reopened_without_changes() {
        let temp = tempfile::tempdir().unwrap();
        let id = created(temp.path(), "Research");
        let path = database(temp.path(), &id);
        let bytes = fs::read(&path).unwrap();
        for _ in 0..2 {
            let workspace = Workspace::open(Some(temp.path()), &id).unwrap();
            assert_eq!(
                header(&workspace.conn).unwrap(),
                (APPLICATION_ID, STORAGE_VERSION)
            );
            assert_eq!(name(&workspace), "Research");
            let foreign_keys: bool = workspace
                .conn
                .pragma_query_value(None, "foreign_keys", |row| row.get(0))
                .unwrap();
            assert!(foreign_keys);
        }
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(
            list_workspaces(Some(temp.path())).unwrap(),
            [(id.clone(), Some(("Research".to_owned(), 0)))]
        );
        // The open workspace stays listed with its count; listing never takes the lock.
        let open = Workspace::open(Some(temp.path()), &id).unwrap();
        open.conn
            .execute_batch(
                "INSERT INTO canvas (id, title, revision, viewport_x, viewport_y, viewport_zoom)
                VALUES ('a', 'A', 1, 0, 0, 1), ('b', 'B', 1, 0, 0, 1);",
            )
            .unwrap();
        assert_eq!(
            list_workspaces(Some(temp.path())).unwrap(),
            [(id.clone(), Some(("Research".to_owned(), 2)))]
        );
        assert_eq!(
            Workspace::open(Some(temp.path()), &id).err().unwrap().code,
            "WORKSPACE_LOCKED"
        );
    }

    #[test]
    fn newer_or_foreign_storage_is_rejected_without_modification() {
        let temp = tempfile::tempdir().unwrap();
        for (pragma, value) in [("user_version", STORAGE_VERSION + 1), ("application_id", 7)] {
            let id = created(temp.path(), "Later");
            let path = database(temp.path(), &id);
            Connection::open(&path)
                .unwrap()
                .pragma_update(None, pragma, value)
                .unwrap();
            let bytes = fs::read(&path).unwrap();
            let error = Workspace::open(Some(temp.path()), &id).err().unwrap();
            assert_eq!(error.code, "UNSUPPORTED_STORAGE");
            assert!(error.message.contains("not modified"), "{}", error.message);
            assert_eq!(fs::read(&path).unwrap(), bytes);
            assert!(list_workspaces(Some(temp.path()))
                .unwrap()
                .contains(&(id.clone(), None)));
            // The failed open released its lock.
            drop(lock_workspace(path.parent().unwrap(), &id).unwrap());
        }
        let id = created(temp.path(), "Newer");
        Connection::open(database(temp.path(), &id))
            .unwrap()
            .pragma_update(None, "user_version", STORAGE_VERSION + 1)
            .unwrap();
        let message = Workspace::open(Some(temp.path()), &id)
            .err()
            .unwrap()
            .message;
        assert!(message.contains("Update Agentica"), "{message}");
    }

    #[test]
    fn failed_migrations_roll_back_completely() {
        let temp = tempfile::tempdir().unwrap();
        let mut conn = connect(&temp.path().join("db"), true).unwrap();
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .unwrap();
        assert!(migrate(&tx, 0, &[MIGRATIONS[0], "CREATE TABLE broken (;"]).is_err());
        drop(tx);
        assert_eq!(header(&conn).unwrap(), (0, 0));
        let tables: i64 = conn
            .query_row("SELECT count(*) FROM sqlite_schema", [], |row| row.get(0))
            .unwrap();
        assert_eq!(tables, 0);
    }

    #[test]
    fn project_migration_is_atomic_and_enforces_membership_and_presets() {
        let temp = tempfile::tempdir().unwrap();
        let mut conn = connect(&temp.path().join("db"), true).unwrap();
        let tx = conn.transaction().unwrap();
        migrate(&tx, 0, &MIGRATIONS[..4]).unwrap();
        tx.execute_batch(
            "INSERT INTO workspace(id, name) VALUES ('w', 'Existing');
            INSERT INTO canvas VALUES ('c', 'Canvas', 3, 14, -20, 0.75);",
        )
        .unwrap();
        tx.commit().unwrap();
        let tx = conn.transaction().unwrap();
        let mut broken = MIGRATIONS.to_vec();
        broken.push("CREATE TABLE broken (;");
        assert!(migrate(&tx, 4, &broken).is_err());
        drop(tx);
        assert_eq!(header(&conn).unwrap(), (APPLICATION_ID, 4));
        assert_eq!(
            conn.query_row(
                "SELECT count(*) FROM sqlite_schema WHERE name = 'project_group'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        let tx = conn.transaction().unwrap();
        migrate(&tx, 4, MIGRATIONS).unwrap();
        tx.execute_batch(
            "INSERT INTO project_group (id, canvas_id, root, label, x, y, width, height)
            VALUES ('g', 'c', '/tmp/project', 'Project', 10, 20, 800, 600);
            INSERT INTO session_tile (id, canvas_id, project_id, kind, preset, x, y, width, height)
            VALUES ('t', 'c', 'g', 'cli-agent', 'codex', 16, 96, 400, 300);",
        )
        .unwrap();
        for sql in [
            "UPDATE session_tile SET canvas_id = 'other'",
            "UPDATE session_tile SET project_id = 'missing'",
            "UPDATE session_tile SET preset = printf('%065d', 0)",
            "UPDATE session_tile SET preset = ''",
            "UPDATE session_tile SET preset = NULL",
            "UPDATE session_tile SET kind = 'shell'",
            "UPDATE session_tile SET revision = 0",
            "UPDATE session_tile SET x = -1",
            "UPDATE project_group SET height = 0",
            "UPDATE project_group SET collapsed = 2",
        ] {
            assert!(tx.execute(sql, []).is_err(), "{sql}");
        }
        tx.commit().unwrap();
        assert_eq!(header(&conn).unwrap(), (APPLICATION_ID, STORAGE_VERSION));
        let viewport: (f64, f64, f64) = conn
            .query_row(
                "SELECT viewport_x, viewport_y, viewport_zoom FROM canvas",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(viewport, (14.0, -20.0, 0.75));
    }

    #[test]
    fn agent_preset_migration_keeps_tiles_and_task_assignments() {
        let temp = tempfile::tempdir().unwrap();
        let mut conn = connect(&temp.path().join("db"), true).unwrap();
        let tx = conn.transaction().unwrap();
        migrate(&tx, 0, &MIGRATIONS[..10]).unwrap();
        tx.execute_batch(
            "INSERT INTO workspace(id, name) VALUES ('w', 'Existing');
            INSERT INTO canvas VALUES ('c', 'Canvas', 3, 0, 0, 1);
            INSERT INTO project_group (id, canvas_id, root, label, x, y, width, height)
            VALUES ('g', 'c', '/tmp/project', 'Project', 10, 20, 800, 600);
            INSERT INTO session_tile (id, canvas_id, project_id, kind, preset, x, y, width, height, revision)
            VALUES ('t', 'c', 'g', 'cli-agent', 'codex', 16, 96, 400, 300, 7);
            INSERT INTO text_task (artifact_id, assigned_tile_id) VALUES ('a', 't');",
        )
        .unwrap();
        migrate(&tx, 10, MIGRATIONS).unwrap();
        tx.commit().unwrap();
        let tile: (String, i64) = conn
            .query_row(
                "SELECT preset, revision FROM session_tile WHERE id = 't'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(tile, ("codex".into(), 7));
        let assigned: String = conn
            .query_row("SELECT assigned_tile_id FROM text_task", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(assigned, "t");
        let dangling: i64 = conn
            .query_row(
                "SELECT count(*) FROM pragma_foreign_key_check('text_task') WHERE parent = 'session_tile'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(dangling, 0);
        conn.execute(
            "UPDATE session_tile SET preset = 'custom:00000000-0000-4000-8000-000000000000'",
            [],
        )
        .unwrap();
    }

    #[test]
    fn task_context_migration_keeps_tasks_without_context() {
        let temp = tempfile::tempdir().unwrap();
        let mut conn = connect(&temp.path().join("db"), true).unwrap();
        let tx = conn.transaction().unwrap();
        migrate(&tx, 0, &MIGRATIONS[..13]).unwrap();
        tx.execute_batch(
            "INSERT INTO text_content (id, body) VALUES ('t', 'Task');
            INSERT INTO artifact VALUES ('a', 'text', 1, 2, 'sqlite', 't');
            INSERT INTO text_task (artifact_id, sent_at, sent_revision) VALUES ('a', 'x', 2);",
        )
        .unwrap();
        migrate(&tx, 13, MIGRATIONS).unwrap();
        tx.commit().unwrap();
        let row: (i64, Option<String>, i64) = conn
            .query_row(
                "SELECT sent_revision, sent_context, (SELECT count(*) FROM task_context) FROM text_task",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(row, (2, None, 0));
    }

    #[test]
    fn legacy_workspaces_upgrade_without_data_loss() {
        for old_version in [1, 2] {
            let temp = tempfile::tempdir().unwrap();
            let id = new_id().unwrap();
            let dir = workspaces_dir(Some(temp.path())).unwrap().join(&id);
            fs::create_dir(&dir).unwrap();
            // Build each legacy storage version with real rows.
            let mut conn = connect(&dir.join(DATABASE_FILE), true).unwrap();
            let tx = conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .unwrap();
            migrate(&tx, 0, &MIGRATIONS[..old_version]).unwrap();
            tx.execute(
                "INSERT INTO workspace (id, name) VALUES (?1, 'Legacy')",
                [&id],
            )
            .unwrap();
            tx.execute(
                "INSERT INTO canvas (id, title, revision, viewport_x, viewport_y, viewport_zoom)
             VALUES ('c', 'Plan', 1, 0, 0, 1)",
                [],
            )
            .unwrap();
            tx.execute(
                "INSERT INTO text_content (id, body) VALUES ('t', 'hello')",
                [],
            )
            .unwrap();
            tx.execute(
            "INSERT INTO artifact (id, type, schema_version, revision, content_store, content_id)
             VALUES ('a', 'text', 1, 1, 'sqlite', 't')",
            [],
        )
        .unwrap();
            tx.execute(
                "INSERT INTO canvas_node (id, canvas_id, kind, artifact_id, x, y, width, height)
             VALUES ('n', 'c', 'artifact', 'a', 0, 0, 100, 100)",
                [],
            )
            .unwrap();
            tx.commit().unwrap();
            drop(conn);

            let workspace = Workspace::open(Some(temp.path()), &id).unwrap();
            assert_eq!(
                header(&workspace.conn).unwrap(),
                (APPLICATION_ID, STORAGE_VERSION)
            );
            // Existing text and its placement survive the table rebuild.
            let body: String = workspace
                .conn
                .query_row("SELECT body FROM text_content WHERE id = 't'", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(body, "hello");
            let purpose: String = workspace
                .conn
                .query_row(
                    "SELECT purpose FROM text_content WHERE id = 't'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(purpose, "note");
            let node_artifact: String = workspace
                .conn
                .query_row(
                    "SELECT artifact_id FROM canvas_node WHERE id = 'n'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(node_artifact, "a");
            // Drawing artifacts are accepted after the upgrade.
            workspace
                .conn
                .execute(
                    "INSERT INTO drawing_content (id, body) VALUES ('d', '{}')",
                    [],
                )
                .unwrap();
            workspace
            .conn
            .execute(
                "INSERT INTO artifact (id, type, schema_version, revision, content_store, content_id)
                 VALUES ('a2', 'drawing', 1, 1, 'sqlite', 'd')",
                [],
            )
            .unwrap();
        }
    }

    #[test]
    fn preview_migration_preserves_existing_artifacts_and_nodes() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", false).unwrap();
        let tx = conn.transaction().unwrap();
        migrate(&tx, 0, &MIGRATIONS[..13]).unwrap();
        tx.execute_batch(
            "INSERT INTO canvas VALUES ('c', 'Canvas', 4, 1, 2, 1);
             INSERT INTO text_content (id, body) VALUES ('t', 'note');
             INSERT INTO drawing_content (id, body) VALUES ('d', '{}');
             INSERT INTO file_content (id, body, name, mime, size, text)
                 VALUES ('f', X'01', 'a.txt', 'text/plain', 1, 'a');
             INSERT INTO artifact VALUES ('at', 'text', 1, 2, 'sqlite', 't');
             INSERT INTO artifact VALUES ('ad', 'drawing', 1, 3, 'sqlite', 'd');
             INSERT INTO artifact VALUES ('af', 'file', 1, 4, 'sqlite', 'f');
             INSERT INTO canvas_node (id, canvas_id, kind, artifact_id, x, y, width, height)
                 VALUES ('nt', 'c', 'artifact', 'at', 1, 2, 100, 200),
                        ('nd', 'c', 'artifact', 'ad', 3, 4, 110, 210),
                        ('nf', 'c', 'artifact', 'af', 5, 6, 120, 220);",
        )
        .unwrap();
        migrate(&tx, 13, MIGRATIONS).unwrap();
        tx.commit().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        let rows: Vec<(String, String, i64, f64, f64, f64, f64)> = conn
            .prepare("SELECT artifact.id, type, revision, x, y, width, height FROM artifact JOIN canvas_node ON artifact.id = artifact_id ORDER BY artifact.id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)))
            .unwrap().map(Result::unwrap).collect();
        assert_eq!(
            rows,
            vec![
                ("ad".into(), "drawing".into(), 3, 3.0, 4.0, 110.0, 210.0),
                ("af".into(), "file".into(), 4, 5.0, 6.0, 120.0, 220.0),
                ("at".into(), "text".into(), 2, 1.0, 2.0, 100.0, 200.0),
            ]
        );
        let values: (String, String, Vec<u8>) = conn.query_row(
            "SELECT (SELECT body FROM text_content WHERE id='t'), (SELECT body FROM drawing_content WHERE id='d'), (SELECT body FROM file_content WHERE id='f')",
            [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ).unwrap();
        assert_eq!(values, ("note".into(), "{}".into(), vec![1]));
        assert!(conn
            .prepare("PRAGMA foreign_key_check")
            .unwrap()
            .query([])
            .unwrap()
            .next()
            .unwrap()
            .is_none());
        conn.execute(
            "INSERT INTO web_preview_content VALUES ('p', 'http://localhost:5173')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO artifact VALUES ('ap', 'web-preview', 1, 1, 'sqlite', 'p')",
            [],
        )
        .unwrap();
    }

    #[test]
    fn v8_upgrade_keeps_text_and_starts_without_tasks() {
        let temp = tempfile::tempdir().unwrap();
        let id = new_id().unwrap();
        let dir = workspaces_dir(Some(temp.path())).unwrap().join(&id);
        fs::create_dir(&dir).unwrap();
        let mut conn = connect(&dir.join(DATABASE_FILE), true).unwrap();
        let tx = conn.transaction().unwrap();
        migrate(&tx, 0, &MIGRATIONS[..8]).unwrap();
        tx.execute(
            "INSERT INTO workspace (id, name) VALUES (?1, 'Legacy')",
            [&id],
        )
        .unwrap();
        tx.execute_batch(
            "INSERT INTO canvas VALUES ('c', 'Plan', 3, 0, 0, 1);
             INSERT INTO text_content (id, body, purpose) VALUES ('t', 'Keep me', 'instruction');
             INSERT INTO artifact VALUES ('a', 'text', 1, 5, 'sqlite', 't');
             INSERT INTO canvas_node VALUES ('n', 'c', 'artifact', 'a', 0, 0, 100, 100);",
        )
        .unwrap();
        tx.commit().unwrap();
        drop(conn);
        let upgraded = Workspace::open(Some(temp.path()), &id).unwrap();
        assert_eq!(
            header(&upgraded.conn).unwrap(),
            (APPLICATION_ID, STORAGE_VERSION)
        );
        let kept: (String, i64) = upgraded
            .conn
            .query_row(
                "SELECT body, revision FROM text_content JOIN artifact ON content_id = text_content.id",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(kept, ("Keep me".into(), 5));
        let tasks: i64 = upgraded
            .conn
            .query_row("SELECT count(*) FROM text_task", [], |row| row.get(0))
            .unwrap();
        assert_eq!(tasks, 0);
    }

    #[test]
    fn project_upgrade_preserves_all_legacy_content_geometry_and_viewport() {
        fn snapshot(conn: &Connection) -> Vec<Vec<Vec<rusqlite::types::Value>>> {
            [
                "workspace",
                "canvas",
                "text_content",
                "drawing_content",
                "artifact",
                "canvas_node",
                "canvas_edge",
                "conversation_turn",
            ]
            .iter()
            .map(|table| {
                // Later versions add columns; compare the legacy ones.
                let columns = if *table == "canvas_node" {
                    "id, canvas_id, kind, artifact_id, x, y, width, height"
                } else {
                    "*"
                };
                let mut statement = conn
                    .prepare(&format!("SELECT {columns} FROM {table} ORDER BY rowid"))
                    .unwrap();
                let columns = statement.column_count();
                statement
                    .query_map([], |row| {
                        (0..columns).map(|column| row.get(column)).collect()
                    })
                    .unwrap()
                    .collect::<Result<Vec<_>, _>>()
                    .unwrap()
            })
            .collect()
        }
        let temp = tempfile::tempdir().unwrap();
        let id = new_id().unwrap();
        let dir = workspaces_dir(Some(temp.path())).unwrap().join(&id);
        fs::create_dir(&dir).unwrap();
        let mut conn = connect(&dir.join(DATABASE_FILE), true).unwrap();
        let tx = conn.transaction().unwrap();
        migrate(&tx, 0, &MIGRATIONS[..4]).unwrap();
        tx.execute(
            "INSERT INTO workspace (id, name) VALUES (?1, 'Legacy')",
            [&id],
        )
        .unwrap();
        tx.execute_batch(r##"
            INSERT INTO canvas VALUES ('c', 'Saved canvas', 17, -123, 456, 0.75);
            INSERT INTO text_content (id, body, purpose) VALUES ('t', 'Saved instruction', 'instruction');
            INSERT INTO drawing_content VALUES ('d', '{"shapes":[{"kind":"rectangle","x":0,"y":0,"width":80,"height":60,"color":"#123456"}]}');
            INSERT INTO artifact VALUES ('a', 'text', 1, 4, 'sqlite', 't');
            INSERT INTO artifact VALUES ('ad', 'drawing', 1, 3, 'sqlite', 'd');
            INSERT INTO canvas_node VALUES ('n', 'c', 'artifact', 'a', -22, 51, 340, 180);
            INSERT INTO canvas_node VALUES ('nd', 'c', 'artifact', 'ad', 333, 222, 160, 120);
            INSERT INTO canvas_edge VALUES ('e', 'c', 'relationship', 'n', 'nd');
            INSERT INTO conversation_turn (id, canvas_id, model, prompt, reply, prompt_node_id, reply_node_id, anchor, context, status)
                VALUES ('turn', 'c', 'saved-model', 'Prompt', 'Reply', 'n', 'nd', '{"x":1,"y":2}', '{"nodes":[]}', 'complete');
        "##).unwrap();
        tx.commit().unwrap();
        let before = snapshot(&conn);
        drop(conn);
        let upgraded = Workspace::open(Some(temp.path()), &id).unwrap();
        assert_eq!(snapshot(&upgraded.conn), before);
        let grouped: i64 = upgraded
            .conn
            .query_row(
                "SELECT count(*) FROM canvas_node WHERE group_id IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(grouped, 0, "upgraded nodes start ungrouped");
        assert_eq!(
            header(&upgraded.conn).unwrap(),
            (APPLICATION_ID, STORAGE_VERSION)
        );
        assert_eq!(
            upgraded
                .conn
                .query_row("SELECT count(*) FROM project_group", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            upgraded
                .conn
                .query_row("SELECT count(*) FROM session_tile", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn upgraded_content_reopens_and_saves_alongside_new_project_groups() {
        use serde_json::{json, Value};
        let call = |runtime: &mut crate::Runtime, method: &str, params: Value| -> Value {
            let response = runtime.handle_request(
                &serde_json::to_vec(&json!({"protocolVersion": 1, "id": "upgrade",
                    "method": method, "params": params}))
                .unwrap(),
            );
            assert!(response["error"].is_null(), "{method}: {response}");
            response["result"].clone()
        };
        let temp = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let [id, canvas, text, artifact, node, drawing, drawn, drawing_node, edge, turn] =
            std::array::from_fn(|_| new_id().unwrap());
        let dir = workspaces_dir(Some(temp.path())).unwrap().join(&id);
        fs::create_dir(&dir).unwrap();
        let mut conn = connect(&dir.join(DATABASE_FILE), true).unwrap();
        let tx = conn.transaction().unwrap();
        migrate(&tx, 0, &MIGRATIONS[..4]).unwrap();
        tx.execute(
            "INSERT INTO workspace (id, name) VALUES (?1, 'Legacy')",
            [&id],
        )
        .unwrap();
        tx.execute(
            "INSERT INTO canvas VALUES (?1, 'Saved', 7, -123, 456, 0.75)",
            [&canvas],
        )
        .unwrap();
        tx.execute(
            "INSERT INTO text_content (id, body, purpose) VALUES (?1, 'Saved note', 'note')",
            [&text],
        )
        .unwrap();
        tx.execute(
            "INSERT INTO drawing_content VALUES (?1, '{\"shapes\":[]}')",
            [&drawing],
        )
        .unwrap();
        tx.execute(
            "INSERT INTO artifact VALUES (?1, 'text', 1, 2, 'sqlite', ?2)",
            [&artifact, &text],
        )
        .unwrap();
        tx.execute(
            "INSERT INTO artifact VALUES (?1, 'drawing', 1, 1, 'sqlite', ?2)",
            [&drawn, &drawing],
        )
        .unwrap();
        tx.execute(
            "INSERT INTO canvas_node VALUES (?1, ?2, 'artifact', ?3, -22, 51, 340, 180)",
            [&node, &canvas, &artifact],
        )
        .unwrap();
        tx.execute(
            "INSERT INTO canvas_node VALUES (?1, ?2, 'artifact', ?3, 333, 222, 160, 120)",
            [&drawing_node, &canvas, &drawn],
        )
        .unwrap();
        tx.execute(
            "INSERT INTO canvas_edge VALUES (?1, ?2, 'relationship', ?3, ?4)",
            [&edge, &canvas, &node, &drawing_node],
        )
        .unwrap();
        tx.execute(
            "INSERT INTO conversation_turn (id, canvas_id, model, prompt, reply, prompt_node_id,
                reply_node_id, anchor, context, status)
             VALUES (?1, ?2, 'saved-model', 'Prompt', 'Reply', ?3, ?4, '{\"x\":1,\"y\":2}',
                '{\"nodes\":[]}', 'complete')",
            [&turn, &canvas, &node, &drawing_node],
        )
        .unwrap();
        tx.commit().unwrap();
        drop(conn);

        let mut runtime = crate::Runtime::new(Some(temp.path().to_owned()));
        call(&mut runtime, "workspace.open", json!({"workspaceId": id}));
        let reference = json!({"workspaceId": id, "canvasId": canvas});
        let opened = call(&mut runtime, "canvas.open", reference.clone());
        assert_eq!(opened["canvas"]["revision"], 7);
        assert_eq!(
            opened["canvas"]["viewport"],
            json!({"x": -123.0, "y": 456.0, "zoom": 0.75})
        );
        assert_eq!(opened["nodes"].as_array().unwrap().len(), 2);
        assert_eq!(opened["nodes"][0]["x"], -22.0);
        assert_eq!(opened["edges"][0]["id"], json!(edge));
        assert_eq!(opened["artifacts"][0]["text"], "Saved note");
        assert_eq!(opened["projectGroups"], json!([]));
        let turns = call(
            &mut runtime,
            "conversation.list",
            json!({"workspaceId": id, "canvasId": canvas, "before": 0}),
        );
        assert_eq!(turns["turns"][0]["reply"], "Reply");

        // Existing objects stay editable and saveable next to a new project.
        let group = call(
            &mut runtime,
            "project.open",
            json!({"workspaceId": id,
            "canvasId": canvas, "expectedRevision": 7, "path": project.path(),
            "x": 600, "y": 0, "width": 800, "height": 600}),
        )["projectId"]
            .clone();
        call(
            &mut runtime,
            "artifact.saveText",
            json!({"workspaceId": id, "artifactId": artifact, "expectedRevision": 2,
                "text": "Edited note"}),
        );
        call(
            &mut runtime,
            "canvas.save",
            json!({"workspaceId": id, "canvasId": canvas,
            "expectedRevision": 8, "viewport": {"x": 5, "y": 6, "zoom": 1.25},
            "nodes": [{"id": node, "x": 10, "y": 20, "width": 340, "height": 180}],
            "projectGroups": [{"id": group, "expectedRevision": 1, "x": 640, "y": 40,
                "width": 800, "height": 600, "collapsed": true}],
            "sessionTiles": []}),
        );
        call(&mut runtime, "workspace.close", json!({"workspaceId": id}));
        call(&mut runtime, "workspace.open", json!({"workspaceId": id}));
        let reopened = call(&mut runtime, "canvas.open", reference);
        assert_eq!(
            reopened["canvas"]["viewport"],
            json!({"x": 5.0, "y": 6.0, "zoom": 1.25})
        );
        assert_eq!(reopened["nodes"][0]["x"], 10.0);
        assert_eq!(reopened["nodes"][1]["x"], 333.0);
        assert_eq!(reopened["artifacts"][0]["text"], "Edited note");
        assert_eq!(reopened["projectGroups"][0]["x"], 640.0);
        assert_eq!(reopened["projectGroups"][0]["collapsed"], true);
        assert_eq!(reopened["edges"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn incomplete_creations_are_skipped_and_never_deleted() {
        let temp = tempfile::tempdir().unwrap();
        let id = new_id().unwrap();
        let path = database(temp.path(), &id);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        Connection::open(&path)
            .unwrap()
            .execute_batch("CREATE TABLE partial (x)")
            .unwrap();
        let bytes = fs::read(&path).unwrap();
        assert!(list_workspaces(Some(temp.path())).unwrap().is_empty());
        assert_eq!(
            Workspace::open(Some(temp.path()), &id).err().unwrap().code,
            "NOT_FOUND"
        );
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(
            delete_workspace(Some(temp.path()), &id).unwrap_err().code,
            "NOT_FOUND"
        );
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(
            Workspace::open(Some(temp.path()), &new_id().unwrap())
                .err()
                .unwrap()
                .code,
            "NOT_FOUND"
        );
    }

    #[test]
    fn deleted_workspaces_are_gone_from_storage_and_the_listing() {
        let temp = tempfile::tempdir().unwrap();
        let id = created(temp.path(), "Temporary");
        let dir = temp.path().join("workspaces").join(&id);
        assert!(dir.is_dir());
        delete_workspace(Some(temp.path()), &id).unwrap();
        assert!(!dir.exists());
        assert!(list_workspaces(Some(temp.path())).unwrap().is_empty());
        // A second delete has nothing left to remove.
        assert_eq!(
            delete_workspace(Some(temp.path()), &id).err().unwrap().code,
            "NOT_FOUND"
        );
        for id in ["../../escape", "", "00000000-0000-4000-8000-00000000000"] {
            assert_eq!(
                delete_workspace(Some(temp.path()), id).err().unwrap().code,
                "NOT_FOUND",
                "{id}"
            );
        }
    }

    #[test]
    fn deletion_preserves_foreign_or_uncommitted_workspace_records() {
        let temp = tempfile::tempdir().unwrap();
        for sql in [
            "PRAGMA application_id = 7",
            "PRAGMA user_version = 0",
            "DELETE FROM workspace",
            "UPDATE workspace SET id = '00000000-0000-4000-8000-000000000000'",
        ] {
            let id = created(temp.path(), "Keep");
            let path = database(temp.path(), &id);
            Connection::open(&path).unwrap().execute_batch(sql).unwrap();
            let bytes = fs::read(&path).unwrap();
            assert_eq!(
                delete_workspace(Some(temp.path()), &id).unwrap_err().code,
                "UNSUPPORTED_STORAGE",
                "{sql}"
            );
            assert_eq!(fs::read(&path).unwrap(), bytes, "{sql}");
        }
    }

    #[test]
    fn a_locked_or_incomplete_workspace_is_never_deleted() {
        let temp = tempfile::tempdir().unwrap();
        let id = created(temp.path(), "Busy");
        let dir = temp.path().join("workspaces").join(&id);
        let held = lock_workspace(&dir, &id).unwrap();
        let error = delete_workspace(Some(temp.path()), &id).unwrap_err();
        assert_eq!(error.code, "WORKSPACE_LOCKED");
        assert!(dir.is_dir());
        drop(held);
        delete_workspace(Some(temp.path()), &id).unwrap();

        // An interrupted creation keeps its files; only listing skips it.
        let partial = new_id().unwrap();
        let partial_dir = temp.path().join("workspaces").join(&partial);
        fs::create_dir_all(&partial_dir).unwrap();
        fs::write(partial_dir.join("partial"), b"x").unwrap();
        assert_eq!(
            delete_workspace(Some(temp.path()), &partial)
                .err()
                .unwrap()
                .code,
            "NOT_FOUND"
        );
        assert!(partial_dir.is_dir());
    }

    #[test]
    fn torn_write_process() {
        let Some(path) = std::env::var_os(TORN_WRITE_ENV) else {
            return;
        };
        let mut conn = connect(Path::new(&path), false).unwrap();
        // A tiny cache forces uncommitted pages onto disk before the crash.
        conn.pragma_update(None, "cache_size", 1).unwrap();
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .unwrap();
        tx.execute("UPDATE workspace SET name = 'Torn'", [])
            .unwrap();
        for index in 0..200 {
            tx.execute(
                "INSERT INTO text_content (id, body) VALUES (?1, ?2)",
                (index.to_string(), "x".repeat(4096)),
            )
            .unwrap();
        }
        println!("WRITING");
        let _ = io::stdin().lines().count();
    }

    /// Kill a writer mid-transaction, leaving a hot journal behind.
    fn crash_writer(path: &Path) {
        let mut writer = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "store::tests::torn_write_process", "--nocapture"])
            .env(TORN_WRITE_ENV, path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut lines = BufReader::new(writer.stdout.take().unwrap()).lines();
        assert!(lines.any(|line| line.unwrap() == "WRITING"));
        writer.kill().unwrap();
        writer.wait().unwrap();
    }

    #[test]
    fn a_crashed_write_is_rolled_back_before_listing_or_deletion() {
        let temp = tempfile::tempdir().unwrap();
        let id = created(temp.path(), "Before");
        let path = database(temp.path(), &id);
        let dir = path.parent().unwrap().to_owned();
        crash_writer(&path);
        // A held writer lock keeps the journal for that writer to roll back.
        let held = lock_workspace(&dir, &id).unwrap();
        assert_eq!(
            list_workspaces(Some(temp.path())).unwrap(),
            [(id.clone(), None)]
        );
        drop(held);
        assert_eq!(
            list_workspaces(Some(temp.path())).unwrap(),
            [(id.clone(), Some(("Before".to_owned(), 0)))]
        );
        crash_writer(&path);
        delete_workspace(Some(temp.path()), &id).unwrap();
        assert!(!dir.exists());
    }

    #[test]
    fn a_writer_killed_mid_transaction_leaves_the_last_committed_state() {
        let temp = tempfile::tempdir().unwrap();
        let id = created(temp.path(), "Before");
        let path = database(temp.path(), &id);
        let committed = fs::read(&path).unwrap();
        crash_writer(&path);
        // The crash left a hot journal and uncommitted pages in the database.
        assert!(path.with_extension("sqlite3-journal").is_file());
        assert_ne!(fs::read(&path).unwrap(), committed);

        let workspace = Workspace::open(Some(temp.path()), &id).unwrap();
        assert_eq!(name(&workspace), "Before");
        let rows: i64 = workspace
            .conn
            .query_row("SELECT count(*) FROM text_content", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 0);
        let check: String = workspace
            .conn
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .unwrap();
        assert_eq!(check, "ok");
        workspace
            .conn
            .execute("UPDATE workspace SET name = 'After'", [])
            .unwrap();
    }

    /// A workspace with a text artifact placed on a canvas, an attached file,
    /// and an enabled MCP server.
    fn populated(root: &Path, name: &str) -> String {
        let id = created(root, name);
        Connection::open(database(root, &id))
            .unwrap()
            .execute_batch(
                "INSERT INTO canvas VALUES ('c', 'Plan', 1, 0, 0, 1);
                INSERT INTO text_content (id, body) VALUES ('t', 'hello');
                INSERT INTO artifact VALUES ('a', 'text', 1, 1, 'sqlite', 't');
                INSERT INTO canvas_node (id, canvas_id, kind, artifact_id, x, y, width, height)
                    VALUES ('n', 'c', 'artifact', 'a', 1, 2, 3, 4);
                INSERT INTO file_content (id, body, name, mime, size)
                    VALUES ('f', x'00ff', 'a.bin', 'application/octet-stream', 2);
                INSERT INTO mcp_server (id, name, transport, command, args, env, enabled)
                    VALUES ('m', 'tool', 'stdio', 'run-me', '[]', '{}', 1);
                INSERT INTO mcp_tool VALUES ('m', 'echo', 'Echo', '{}', 1, 1);",
            )
            .unwrap();
        id
    }

    fn contents(conn: &Connection) -> (String, String, Vec<u8>) {
        conn.query_row(
            "SELECT c.title, t.body, f.body FROM canvas c, text_content t, file_content f",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap()
    }

    fn rejected(root: &Path, file: &Path) -> RuntimeError {
        let before = list_workspaces(Some(root)).unwrap();
        let error = restore_workspace(Some(root), file).unwrap_err();
        assert_eq!(list_workspaces(Some(root)).unwrap(), before);
        // Nothing staged is left behind.
        assert_eq!(
            fs::read_dir(workspaces_dir(Some(root)).unwrap())
                .unwrap()
                .count(),
            before.len()
        );
        error
    }

    #[test]
    fn backup_copies_an_open_workspace_without_changing_it() {
        let temp = tempfile::tempdir().unwrap();
        let id = populated(temp.path(), "Notes");
        let open = Workspace::open(Some(temp.path()), &id).unwrap();
        let file = temp.path().join("notes.agentica");
        fs::write(&file, "older backup").unwrap();
        backup_workspace(Some(temp.path()), &id, &file).unwrap();
        let copy = Connection::open(&file).unwrap();
        assert_eq!(header(&copy).unwrap(), (APPLICATION_ID, STORAGE_VERSION));
        assert_eq!(contents(&copy), contents(&open.conn));
        assert_eq!(name(&open), "Notes");
        // Only the backup is left beside the workspaces directory.
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 2);
    }

    #[test]
    fn backup_accepts_a_long_multibyte_filename() {
        let temp = tempfile::tempdir().unwrap();
        let id = populated(temp.path(), "Notes");
        let file = temp.path().join(format!("{}.agentica", "中".repeat(80)));
        fs::write(&file, "older backup").unwrap();
        backup_workspace(Some(temp.path()), &id, &file).unwrap();
        let copy = Connection::open(&file).unwrap();
        assert_eq!(header(&copy).unwrap(), (APPLICATION_ID, STORAGE_VERSION));
        assert_eq!(contents(&copy).1, "hello");
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 2);
    }

    #[test]
    fn backup_of_an_unknown_workspace_writes_nothing() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("none.agentica");
        for id in [new_id().unwrap(), "../escape".to_owned()] {
            let error = backup_workspace(Some(temp.path()), &id, &file).unwrap_err();
            assert_eq!(error.code, "NOT_FOUND");
        }
        let id = created(temp.path(), "A");
        let missing = temp.path().join("missing").join("x.agentica");
        let error = backup_workspace(Some(temp.path()), &id, &missing).unwrap_err();
        assert_eq!(error.code, "STORAGE_ERROR");
        assert!(!file.exists());
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 1);
    }

    #[test]
    fn preview_backup_preserves_configuration_and_geometry() {
        let temp = tempfile::tempdir().unwrap();
        let id = populated(temp.path(), "Mixed");
        let workspace = Workspace::open(Some(temp.path()), &id).unwrap();
        let canvas: String = workspace
            .conn
            .query_row("SELECT id FROM canvas LIMIT 1", [], |r| r.get(0))
            .unwrap();
        workspace.conn.execute("INSERT INTO web_preview_content VALUES ('preview-content', 'http://localhost:5173/path')", []).unwrap();
        workspace.conn.execute("INSERT INTO artifact VALUES ('preview-artifact', 'web-preview', 1, 2, 'sqlite', 'preview-content')", []).unwrap();
        workspace.conn.execute("INSERT INTO canvas_node (id, canvas_id, kind, artifact_id, x, y, width, height) VALUES ('preview-node', ?1, 'artifact', 'preview-artifact', 17, 23, 600, 400)", [&canvas]).unwrap();
        drop(workspace);
        let file = temp.path().join("preview.agentica");
        backup_workspace(Some(temp.path()), &id, &file).unwrap();
        let (restored, _) = restore_workspace(Some(temp.path()), &file).unwrap();
        let copy = Workspace::open(Some(temp.path()), &restored).unwrap();
        let row: (String, String, i64, f64, f64, f64, f64) = copy.conn.query_row("SELECT a.id, p.url, a.revision, n.x, n.y, n.width, n.height FROM artifact a JOIN web_preview_content p ON p.id=a.content_id JOIN canvas_node n ON n.artifact_id=a.id WHERE a.type='web-preview'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))).unwrap();
        assert_eq!(
            row,
            (
                "preview-artifact".into(),
                "http://localhost:5173/path".into(),
                2,
                17.0,
                23.0,
                600.0,
                400.0
            )
        );
        // Older records must remain restorable even though new IPv6 URLs are rejected.
        copy.conn
            .execute(
                "UPDATE web_preview_content SET url = 'http://[::1]:5173/restored'",
                [],
            )
            .unwrap();
        drop(copy);
        let ipv6_backup = temp.path().join("ipv6.agentica");
        backup_workspace(Some(temp.path()), &restored, &ipv6_backup).unwrap();
        let (ipv6_id, _) = restore_workspace(Some(temp.path()), &ipv6_backup).unwrap();
        let ipv6_copy = Workspace::open(Some(temp.path()), &ipv6_id).unwrap();
        let url: String = ipv6_copy
            .conn
            .query_row("SELECT url FROM web_preview_content", [], |row| row.get(0))
            .unwrap();
        assert_eq!(url, "http://[::1]:5173/restored");
    }

    #[test]
    fn restore_adds_a_new_workspace_beside_the_original() {
        let temp = tempfile::tempdir().unwrap();
        let id = populated(temp.path(), "Notes");
        let file = temp.path().join("notes.agentica");
        backup_workspace(Some(temp.path()), &id, &file).unwrap();
        let (restored, name) = restore_workspace(Some(temp.path()), &file).unwrap();
        assert_ne!(restored, id);
        assert_eq!(name, "Notes (restored)");
        let listed = list_workspaces(Some(temp.path())).unwrap();
        assert!(listed.contains(&(id.clone(), Some(("Notes".to_owned(), 1)))));
        assert!(listed.contains(&(restored.clone(), Some((name, 1)))));
        let original = Workspace::open(Some(temp.path()), &id).unwrap();
        let copy = Workspace::open(Some(temp.path()), &restored).unwrap();
        assert_eq!(contents(&copy.conn), contents(&original.conn));
        let enabled = |conn: &Connection| -> i64 {
            conn.query_row("SELECT enabled FROM mcp_server", [], |row| row.get(0))
                .unwrap()
        };
        assert_eq!(enabled(&copy.conn), 0);
        assert_eq!(enabled(&original.conn), 1);
        let restored_server: String = copy
            .conn
            .query_row("SELECT id FROM mcp_server", [], |row| row.get(0))
            .unwrap();
        assert!(is_id(&restored_server));
        assert_ne!(restored_server, "m");
        let tool_server: String = copy
            .conn
            .query_row(
                "SELECT server_id FROM mcp_tool WHERE name = 'echo' AND enabled = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tool_server, restored_server);
        assert!(!copy
            .conn
            .prepare("PRAGMA foreign_key_check")
            .unwrap()
            .exists([])
            .unwrap());
    }

    #[test]
    fn restore_shortens_a_long_name_to_fit() {
        let temp = tempfile::tempdir().unwrap();
        let id = created(temp.path(), &"é".repeat(crate::commands::MAX_LABEL));
        let file = temp.path().join("long.agentica");
        backup_workspace(Some(temp.path()), &id, &file).unwrap();
        let (_, name) = restore_workspace(Some(temp.path()), &file).unwrap();
        assert_eq!(name.encode_utf16().count(), crate::commands::MAX_LABEL);
        assert!(name.ends_with(" (restored)"));
    }

    #[test]
    fn restore_names_a_blank_backup_workspace() {
        let temp = tempfile::tempdir().unwrap();
        let id = created(temp.path(), "  ");
        let file = temp.path().join("blank.agentica");
        backup_workspace(Some(temp.path()), &id, &file).unwrap();
        let (_, name) = restore_workspace(Some(temp.path()), &file).unwrap();
        assert_eq!(name, "Workspace (restored)");
    }

    #[test]
    fn abandoned_restores_are_removed_but_running_ones_are_kept() {
        let temp = tempfile::tempdir().unwrap();
        let id = created(temp.path(), "Kept");
        let dir = workspaces_dir(Some(temp.path())).unwrap();
        let staging = dir.join(format!(".restore-{}", new_id().unwrap()));
        fs::create_dir(&staging).unwrap();
        fs::write(staging.join(DATABASE_FILE), "partial").unwrap();
        list_workspaces(Some(temp.path())).unwrap();
        assert!(staging.exists());
        remove_abandoned_restores(&dir, Duration::ZERO);
        assert!(!staging.exists());
        assert!(dir.join(&id).exists());
    }

    #[test]
    fn restore_migrates_an_older_backup() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("old.agentica");
        let mut conn = connect(&file, true).unwrap();
        let tx = conn.transaction().unwrap();
        migrate(&tx, 0, &MIGRATIONS[..4]).unwrap();
        tx.execute("INSERT INTO workspace (id, name) VALUES ('w', 'Old')", [])
            .unwrap();
        tx.commit().unwrap();
        drop(conn);
        let (id, _) = restore_workspace(Some(temp.path()), &file).unwrap();
        let workspace = Workspace::open(Some(temp.path()), &id).unwrap();
        assert_eq!(header(&workspace.conn).unwrap().1, STORAGE_VERSION);
    }

    #[test]
    fn restore_rejects_files_that_are_not_valid_backups() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("data");
        let id = populated(temp.path(), "Notes");
        let good = temp.path().join("good.agentica");
        backup_workspace(Some(temp.path()), &id, &good).unwrap();
        let variant = |name: &str, change: &dyn Fn(&Path)| {
            let path = temp.path().join(name);
            fs::copy(&good, &path).unwrap();
            change(&path);
            path
        };
        let text = temp.path().join("notes.txt");
        fs::write(&text, "not a database at all, just some text").unwrap();
        let foreign = temp.path().join("foreign.sqlite3");
        Connection::open(&foreign)
            .unwrap()
            .execute_batch("CREATE TABLE t (x)")
            .unwrap();
        let newer = variant("newer.agentica", &|path| {
            Connection::open(path)
                .unwrap()
                .pragma_update(None, "user_version", STORAGE_VERSION + 1)
                .unwrap()
        });
        let trigger = variant("trigger.agentica", &|path| {
            Connection::open(path)
                .unwrap()
                .execute_batch(
                    "CREATE TRIGGER sneaky AFTER UPDATE ON workspace BEGIN DELETE FROM canvas; END",
                )
                .unwrap()
        });
        // Corrupt, so restore says "damaged" if it checks integrity before the schema.
        let virtual_table = variant("fts.agentica", &|path| {
            Connection::open(path)
                .unwrap()
                .execute_batch(
                    "CREATE VIRTUAL TABLE f USING fts5(a);
                    INSERT INTO f VALUES ('hello');
                    DELETE FROM f_docsize;",
                )
                .unwrap()
        });
        let empty = variant("empty.agentica", &|path| {
            Connection::open(path)
                .unwrap()
                .execute_batch("DELETE FROM workspace")
                .unwrap()
        });
        let damaged = variant("damaged.agentica", &|path| {
            let mut bytes = fs::read(path).unwrap();
            let page = 4096;
            for byte in &mut bytes[page + 8..2 * page] {
                *byte = 0xa5;
            }
            fs::write(path, bytes).unwrap();
        });
        for (file, expected) in [
            (&text, "not an Agentica workspace"),
            (&foreign, "not an Agentica workspace"),
            (&newer, "Update Agentica"),
            (&trigger, "does not create"),
            (&virtual_table, "does not create"),
            (&empty, "no workspace record"),
            (&damaged, "damaged"),
        ] {
            let error = rejected(&root, file);
            assert_eq!(
                error.code, "UNSUPPORTED_STORAGE",
                "{file:?}: {}",
                error.message
            );
            assert!(
                error.message.contains(expected),
                "{file:?}: {}",
                error.message
            );
            assert!(error.message.contains("No workspace was added"));
        }
    }
}
