//! Bracketed paste that never submits. The payload cannot end the paste early.
use super::MAX_SESSION_FRAME_BYTES;

const START: &[u8] = b"\x1b[200~";
const END: &[u8] = b"\x1b[201~";
/// Text bytes that fit one PTY input frame together with both paste markers.
pub const MAX_PASTE_TEXT_BYTES: usize = MAX_SESSION_FRAME_BYTES - START.len() - END.len();

/// Normalize line endings to `\n`, keep tabs, and drop every other control
/// character (C0 including ESC, DEL, and C1), so no escape sequence survives.
pub fn sanitize(text: &str) -> String {
    let mut clean = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                clean.push('\n');
            }
            '\n' | '\t' => clean.push(c),
            c if c.is_control() => {}
            c => clean.push(c),
        }
    }
    clean
}

/// Wrap sanitized text in bracketed-paste markers with nothing after the end marker.
pub fn bracketed(text: &str) -> Vec<u8> {
    [START, sanitize(text).as_bytes(), END].concat()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paste_strips_escapes_and_never_appends_enter() {
        let hostile = "fix\x1b[201~\rrm -rf /\x1b]0;x\x07\u{9b}31m\r\nok\tdone\x7f\0";
        assert_eq!(sanitize(hostile), "fix[201~\nrm -rf /]0;x31m\nok\tdone");
        let bytes = bracketed("a\nb\n");
        assert_eq!(bytes, b"\x1b[200~a\nb\n\x1b[201~");
        assert!(bytes.ends_with(END));
        // Exactly one start and one end marker, whatever the input.
        let bytes = bracketed("\x1b[200~\x1b[201~");
        assert_eq!(bytes.iter().filter(|b| **b == 0x1b).count(), 2);
    }
}
