//! Observe terminal signals without changing the renderer's byte stream.
use serde::Serialize;

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Bell,
    Notification,
    Exited,
    Failed,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct Attention {
    pub raised: bool,
    pub count: u32,
    pub sequence: u64,
    pub kind: Option<Kind>,
    pub at: Option<u64>,
    pub message: Option<String>,
}

impl Attention {
    pub(super) fn raise(&mut self, kind: Kind, message: Option<String>) {
        self.raised = true;
        self.count = self.count.saturating_add(1);
        self.sequence = self.sequence.saturating_add(1).min((1 << 53) - 1);
        self.kind = Some(kind);
        self.message = message;
        self.at = Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        );
    }

    pub(super) fn clear(&mut self, sequence: u64) {
        if sequence >= self.sequence {
            *self = Self {
                sequence: self.sequence,
                ..Self::default()
            };
        }
    }
}

#[derive(Clone, Copy, Default)]
enum State {
    #[default]
    Ground,
    Escape,
    Csi,
    Param,
    Payload,
    String,
    StringEsc,
}

#[derive(Default)]
pub(super) struct Scanner {
    state: State,
    param: u8,
    digits: u8,
    notification: bool,
    payload: Vec<u8>,
    prefix_digits: bool,
    subcommand: bool,
    payload_started: bool,
    ignored_string: bool,
    osc_string: bool,
}

impl Scanner {
    pub(super) fn scan(&mut self, bytes: &[u8], mut signal: impl FnMut(Kind, Option<String>)) {
        for &byte in bytes {
            if matches!(byte, 0x18 | 0x1a) && !matches!(self.state, State::Ground) {
                self.state = State::Ground;
                self.notification = false;
                self.payload.clear();
                continue;
            }
            match self.state {
                State::Ground => match byte {
                    7 => signal(Kind::Bell, None),
                    0x1b => self.state = State::Escape,
                    _ => {}
                },
                State::Escape => match byte {
                    7 => signal(Kind::Bell, None),
                    b']' => {
                        self.param = 0;
                        self.digits = 0;
                        self.notification = false;
                        self.payload.clear();
                        self.prefix_digits = true;
                        self.subcommand = false;
                        self.payload_started = false;
                        self.ignored_string = false;
                        self.osc_string = true;
                        self.state = State::Param;
                    }
                    b'[' => self.state = State::Csi,
                    b'P' | b'X' | b'^' | b'_' => {
                        self.notification = false;
                        self.ignored_string = true;
                        self.osc_string = false;
                        self.state = State::String;
                    }
                    0x1b => {}
                    // ESC intermediates (e.g. character-set selection).
                    0x20..=0x2f => {}
                    _ => self.state = State::Ground,
                },
                State::Csi => match byte {
                    7 => signal(Kind::Bell, None),
                    0x1b => self.state = State::Escape,
                    0x40..=0x7e => self.state = State::Ground,
                    _ => {}
                },
                State::Param => match byte {
                    b'0'..=b'9' => {
                        self.param = self.param.saturating_mul(10).saturating_add(byte - b'0');
                        self.digits = self.digits.saturating_add(1);
                    }
                    b';' => {
                        self.notification = self.param == 9 && self.digits > 0 && self.digits <= 3;
                        self.state = State::Payload;
                    }
                    7 => self.state = State::Ground,
                    0x1b => self.state = State::StringEsc,
                    _ => {
                        self.ignored_string = true;
                        self.state = State::String;
                    }
                },
                State::Payload => match byte {
                    7 => self.finish(&mut signal),
                    0x1b => self.state = State::StringEsc,
                    _ if self.notification => {
                        if self.prefix_digits && byte == b';' && self.payload_started {
                            self.subcommand = true;
                        }
                        self.prefix_digits &= byte.is_ascii_digit();
                        self.payload_started = true;
                        if self.payload.len() < 1024 {
                            self.payload.push(byte);
                        }
                    }
                    _ => {}
                },
                State::String => match byte {
                    7 if self.osc_string => self.state = State::Ground,
                    0x1b => self.state = State::StringEsc,
                    _ => {}
                },
                State::StringEsc => {
                    if byte == b'\\' {
                        self.finish(&mut signal);
                    } else if self.ignored_string {
                        self.state = if byte == 0x1b {
                            State::StringEsc
                        } else {
                            State::String
                        };
                    } else {
                        self.notification = false;
                        self.payload.clear();
                        // An unrecognized escape aborts the OSC string.
                        self.state = State::Ground;
                    }
                }
            }
        }
    }

    fn finish(&mut self, signal: &mut impl FnMut(Kind, Option<String>)) {
        if self.notification && !self.subcommand {
            let text = String::from_utf8_lossy(&self.payload)
                .chars()
                .filter(|ch| !ch.is_control())
                .take(256)
                .collect();
            signal(Kind::Notification, Some(text));
        }
        self.notification = false;
        self.payload.clear();
        self.state = State::Ground;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signals(bytes: &[u8], chunk: usize) -> Vec<(Kind, Option<String>)> {
        let mut scanner = Scanner::default();
        let mut result = vec![];
        for bytes in bytes.chunks(chunk) {
            scanner.scan(bytes, |kind, message| result.push((kind, message)));
            assert!(scanner.payload.len() <= 1024);
        }
        result
    }

    #[test]
    fn escape_strings_and_chunk_boundaries() {
        let bytes = b"\x1b]0;prompt\x07\x1b]7;file://cwd\x1b\\\x1b]9;4;1;50\x07\x1b]9;9;/cwd\x1b\\\x1bP\x1b]9;wrapped\x07\x1b\\\x1b_ignored\x07\x1b\\\x1b^ignored\x1b\\\x1bXignored\x07\x1b\\\x1b[1;\x07m\x1b]9;abort\x18\x1b]9;abort\x1a\xc4\x9d\xc4\x90\x07\x1b]9;Approval requested\x07\x1b]9;Turn finished\x1b\\";
        let expected = vec![
            (Kind::Bell, None),
            (Kind::Bell, None),
            (Kind::Notification, Some("Approval requested".into())),
            (Kind::Notification, Some("Turn finished".into())),
        ];
        for chunk in 1..=bytes.len() {
            assert_eq!(signals(bytes, chunk), expected, "chunk {chunk}");
        }
    }

    #[test]
    fn bell_in_escape_preserves_state_and_notification() {
        let bytes = b"\x1b\x07";
        for chunk in 1..=bytes.len() {
            let mut scanner = Scanner::default();
            let mut result = vec![];
            for bytes in bytes.chunks(chunk) {
                scanner.scan(bytes, |kind, message| result.push((kind, message)));
            }
            assert_eq!(result, vec![(Kind::Bell, None)], "chunk {chunk}");
            assert!(matches!(scanner.state, State::Escape), "chunk {chunk}");
        }

        let bytes = b"\x1b\x07]9;done\x07";
        for chunk in 1..=bytes.len() {
            assert_eq!(
                signals(bytes, chunk),
                vec![
                    (Kind::Bell, None),
                    (Kind::Notification, Some("done".into()))
                ],
                "chunk {chunk}"
            );
        }
    }

    #[test]
    fn bell_in_csi_preserves_state() {
        let bytes = b"\x1b[1;\x07";
        for chunk in 1..=bytes.len() {
            let mut scanner = Scanner::default();
            let mut result = vec![];
            for bytes in bytes.chunks(chunk) {
                scanner.scan(bytes, |kind, message| result.push((kind, message)));
            }
            assert_eq!(result, vec![(Kind::Bell, None)], "chunk {chunk}");
            assert!(matches!(scanner.state, State::Csi), "chunk {chunk}");
            scanner.scan(b"m", |_, _| panic!("CSI final must not signal"));
            assert!(matches!(scanner.state, State::Ground), "chunk {chunk}");
        }
    }

    #[test]
    fn ignored_strings_preserve_state_on_bell() {
        for introducer in ['P', 'X', '^', '_'] {
            let bytes = format!("\x1b{introducer}ignored\x07\x07\x1b]9;hidden\x07\x1b\\\x07");
            for chunk in 1..=bytes.len() {
                assert_eq!(
                    signals(bytes.as_bytes(), chunk),
                    vec![(Kind::Bell, None)],
                    "introducer {introducer}, chunk {chunk}"
                );
            }
        }
    }

    #[test]
    fn malformed_osc_still_terminates_on_bell() {
        for bytes in [
            b"\x1b]invalid\x07\x07".as_slice(),
            b"\x1b]invalid\x1bQ\x07\x07",
        ] {
            for chunk in 1..=bytes.len() {
                assert_eq!(
                    signals(bytes, chunk),
                    vec![(Kind::Bell, None)],
                    "chunk {chunk}"
                );
            }
        }
    }

    #[test]
    fn bounded_lossy_plain_text_and_long_numeric_prefix() {
        let mut bytes = b"\x1b]9;\t<script>\xff".to_vec();
        bytes.extend("界".repeat(800).as_bytes());
        bytes.extend(b"\x07\x07");
        let result = signals(&bytes, 1);
        let text = result[0].1.as_ref().unwrap();
        assert_eq!(text.chars().count(), 256);
        assert!(text.starts_with("<script>�"));
        assert!(!text.chars().any(char::is_control));
        assert_eq!(result[1], (Kind::Bell, None));
        let bytes = format!("\x1b]9;{};cwd\x07", "9".repeat(2000));
        assert!(signals(bytes.as_bytes(), 1).is_empty());
    }
}
