use std::{
    fs::File,
    io::{self, Write},
    path::Path,
};
use tauri_plugin_dialog::FilePath;

pub(super) fn suggested_file_name(name: &str) -> String {
    let safe = super::safe_file_name(name);
    let safe = safe.trim_matches(|c: char| c.is_whitespace() || c == '.');
    let stem = safe
        .rsplit_once('.')
        .filter(|(_, extension)| extension.eq_ignore_ascii_case("md"))
        .map_or(safe, |(stem, _)| stem);
    let mut stem = stem.to_owned();
    // Leave room for the extension on filesystems with a 255-byte name limit.
    while stem.len() > 180 {
        stem.pop();
    }
    let stem = stem.trim_matches(|c: char| c.is_whitespace() || c == '.');
    if !stem
        .chars()
        .any(|c| !matches!(c, '_' | '.') && !c.is_whitespace())
    {
        return "canvas.md".into();
    }
    let device = stem
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end()
        .to_ascii_uppercase();
    let reserved = matches!(
        device.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) || ["COM", "LPT"].iter().any(|prefix| {
        device.strip_prefix(prefix).is_some_and(|suffix| {
            matches!(
                suffix,
                "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
            )
        })
    });
    format!("{}{stem}.md", if reserved { "_" } else { "" })
}

pub(super) fn save_selection(selection: Option<FilePath>, markdown: &str) -> Result<bool, String> {
    let Some(selection) = selection else {
        return Ok(false);
    };
    let path = selection
        .into_path()
        .map_err(|error| format!("Choose a local Markdown file: {error}"))?;
    write_atomic(&path, |file| file.write_all(markdown.as_bytes())).map_err(|error| {
        format!("Could not save Markdown: {error}. Choose a writable folder and try again.")
    })?;
    Ok(true)
}

fn write_atomic(path: &Path, write: impl FnOnce(&mut File) -> io::Result<()>) -> io::Result<()> {
    let parent = path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    write(temporary.as_file_mut())?;
    temporary.as_file_mut().flush()?;
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|error| error.error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn suggested_names_are_safe_markdown_basenames() {
        for (input, expected) in [
            ("Notes.md", "Notes.md"),
            ("Notes.MD", "Notes.md"),
            ("Notes.Md", "Notes.md"),
            ("Notes.exe", "Notes.exe.md"),
            ("../folder\\note\n:*?<>|\"", "_folder_note________.md"),
            ("", "canvas.md"),
            ("  .. ", "canvas.md"),
            ("/\\:*?<>|\n", "canvas.md"),
            (" .md ", "md.md"),
            ("CON.md", "_CON.md"),
            ("prn.txt.md", "_prn.txt.md"),
            ("LPT9.md", "_LPT9.md"),
            ("COM¹.md", "_COM¹.md"),
            ("CONIN$.md", "_CONIN$.md"),
            ("COM0.md", "COM0.md"),
            (" café.md. ", "café.md"),
        ] {
            assert_eq!(suggested_file_name(input), expected, "{input:?}");
        }
    }

    #[test]
    fn long_unicode_suggested_names_fit_a_file_name() {
        let name = suggested_file_name(&"画".repeat(200));
        assert!(name.len() <= 184);
        assert!(name.ends_with(".md"));
        assert!(!name.contains('\u{fffd}'));
    }

    #[test]
    fn save_writes_complete_utf8_without_temporary_output() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("chosen.md");
        let markdown = "# Café\n\n- [x] 完了\n";
        assert!(save_selection(Some(FilePath::Path(path.clone())), markdown).unwrap());
        assert_eq!(fs::read_to_string(&path).unwrap(), markdown);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn save_replaces_an_existing_destination() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("chosen.md");
        fs::write(&path, "previous").unwrap();
        save_selection(Some(FilePath::Path(path.clone())), "replacement").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "replacement");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn partial_write_failure_preserves_existing_destination_and_cleans_up() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("chosen.md");
        fs::write(&path, "previous").unwrap();
        let result = write_atomic(&path, |file| {
            file.write_all(b"partial")?;
            Err(io::Error::other("simulated disk full"))
        });
        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "previous");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn partial_write_failure_leaves_no_new_destination_or_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let result = write_atomic(&dir.path().join("chosen.md"), |file| {
            file.write_all(b"partial")?;
            Err(io::Error::other("simulated disk full"))
        });
        assert!(result.is_err());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn persist_failure_preserves_destination_and_cleans_up() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("chosen.md");
        fs::create_dir(&path).unwrap();
        fs::write(path.join("previous"), "keep").unwrap();
        let error = save_selection(Some(FilePath::Path(path.clone())), "replacement").unwrap_err();
        assert!(error.contains("Choose a writable folder"));
        assert_eq!(fs::read_to_string(path.join("previous")).unwrap(), "keep");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn unavailable_parent_returns_an_error_without_creating_directories() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing").join("chosen.md");
        assert!(save_selection(Some(FilePath::Path(path)), "content").is_err());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn cancellation_returns_false_without_writing() {
        assert!(!save_selection(None, "content").unwrap());
    }
}
