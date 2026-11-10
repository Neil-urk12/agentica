//! macOS apps opened from Finder or the Dock inherit launchd's minimal `PATH`,
//! so agents installed by Homebrew, npm, or version managers would be missed.
//! The desktop host adopts the `PATH` the user's login shell reports.

#[cfg(any(target_os = "macos", test))]
const MARKER: &str = "__AGENTICA_PATH__";

/// The absolute entries of the value printed between two markers, or `None`
/// if the markers are missing or no absolute entry remains. Empty and relative
/// entries are dropped: they would search the current directory. Works on raw
/// bytes, so non-UTF-8 shell output or `PATH` entries do not defeat it.
#[cfg(any(target_os = "macos", test))]
fn parse(output: &[u8]) -> Option<Vec<u8>> {
    let marker = MARKER.as_bytes();
    let find = |bytes: &[u8]| {
        bytes
            .windows(marker.len())
            .position(|window| window == marker)
    };
    let start = find(output)? + marker.len();
    let end = start + find(&output[start..])?;
    let entries: Vec<&[u8]> = output[start..end]
        .trim_ascii()
        .split(|&byte| byte == b':')
        .filter(|entry| entry.starts_with(b"/"))
        .collect();
    (!entries.is_empty()).then(|| entries.join(&b':'))
}

/// Must run before any other thread starts: it changes the process environment.
/// Any failure keeps the inherited `PATH`.
#[cfg(target_os = "macos")]
pub(crate) fn import() {
    use std::{
        ffi::OsString,
        io::Read,
        os::unix::ffi::OsStringExt,
        process::{Command, Stdio},
        sync::mpsc,
        thread,
        time::Duration,
    };
    let shell = std::env::var_os("SHELL")
        .filter(|shell| !shell.is_empty())
        .unwrap_or_else(|| "/bin/zsh".into());
    // printenv reads the exported, colon-joined value, whatever the shell's syntax for lists.
    let script = format!("echo {MARKER}; /usr/bin/printenv PATH; echo {MARKER}");
    let Ok(mut child) = Command::new(shell)
        .args(["-l", "-i", "-c", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return;
    };
    let Some(mut stdout) = child.stdout.take() else {
        return;
    };
    let (send, receive) = mpsc::channel();
    // Read until both markers arrive, not to EOF: a job the rc files start
    // in the background can hold stdout open after the shell exits.
    let _ = thread::Builder::new()
        .name("login-path".into())
        .spawn(move || {
            let mut bytes = Vec::new();
            let mut buffer = [0; 4096];
            while let Ok(count @ 1..) = stdout.read(&mut buffer) {
                bytes.extend_from_slice(&buffer[..count]);
                if let Some(path) = parse(&bytes) {
                    let _ = send.send(path);
                    return;
                }
                if bytes.len() > 1024 * 1024 {
                    return;
                }
            }
        });
    let path = receive.recv_timeout(Duration::from_secs(5));
    let _ = child.kill();
    let _ = child.wait();
    if let Ok(path) = path {
        std::env::set_var("PATH", OsString::from_vec(path));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn marked(banner: &[u8], path: &[u8]) -> Vec<u8> {
        let marker = MARKER.as_bytes();
        [banner, marker, b"\n", path, b"\n", marker, b"\n"].concat()
    }

    #[test]
    fn keeps_the_absolute_entries_between_the_markers() {
        let parsed = |banner: &[u8], path: &[u8]| parse(&marked(banner, path));
        let expected = Some(b"/opt/homebrew/bin:/usr/bin".to_vec());
        assert_eq!(
            parsed(
                b"Last login: Mon\nWelcome!\n",
                b"/opt/homebrew/bin:/usr/bin"
            ),
            expected
        );
        // A Latin-1 banner byte before the markers does not hide the value.
        assert_eq!(
            parsed(b"Willkommen \xfc\n", b"/opt/homebrew/bin:/usr/bin"),
            expected
        );
        // Empty and relative entries are dropped; the absolute ones are kept.
        assert_eq!(parsed(b"", b"/opt/homebrew/bin:/usr/bin:"), expected);
        assert_eq!(
            parsed(b"", b".:/opt/homebrew/bin::node_modules/.bin:/usr/bin"),
            expected
        );
        // Non-UTF-8 entries are kept byte for byte.
        assert_eq!(
            parsed(b"", b"/opt/caf\xe9/bin"),
            Some(b"/opt/caf\xe9/bin".to_vec())
        );
    }

    #[test]
    fn missing_markers_or_no_absolute_entry_keep_the_inherited_path() {
        let marker = MARKER.as_bytes();
        assert_eq!(parse(b"/usr/bin:/bin"), None);
        assert_eq!(parse(&[marker, b"\n/usr/bin\n"].concat()), None);
        assert_eq!(parse(&marked(b"", b"")), None);
        assert_eq!(parse(&marked(b"", b".:node_modules/.bin")), None);
    }
}
