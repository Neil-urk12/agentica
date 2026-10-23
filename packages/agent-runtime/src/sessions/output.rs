use super::*;
use std::collections::VecDeque;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputFrame {
    pub sequence: u64,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputPage {
    pub history_gap: bool,
    pub next_sequence: u64,
    pub last_sequence: u64,
    pub frames: Vec<OutputFrame>,
}

struct Attachment {
    id: String,
    acknowledged: u64,
    sent: u64,
    outstanding: VecDeque<(u64, usize)>,
}

#[derive(Default)]
pub(super) struct Output {
    retained: VecDeque<OutputFrame>,
    retained_bytes: usize,
    sequence: u64,
    attachment: Option<Attachment>,
}

impl Output {
    pub(super) fn push(&mut self, bytes: &[u8]) -> Result<(), RuntimeError> {
        if bytes.is_empty()
            || bytes.len() > MAX_SESSION_FRAME_BYTES
            || self.sequence >= (1 << 53) - 1
        {
            return Err(RuntimeError::new(
                "INVALID_PARAMS",
                "Invalid terminal output frame or exhausted sequence cursor.",
            ));
        }
        self.sequence += 1;
        self.retained_bytes += bytes.len();
        self.retained.push_back(OutputFrame {
            sequence: self.sequence,
            bytes: bytes.to_vec(),
        });
        while self.retained_bytes > MAX_RETAINED_BYTES || self.retained.len() > 4096 {
            self.retained_bytes -= self.retained.pop_front().unwrap().bytes.len();
        }
        Ok(())
    }

    pub(super) fn attach(&mut self, after: u64) -> Result<String, RuntimeError> {
        if self.attachment.is_some() {
            return Err(RuntimeError::new(
                "CONFLICT",
                "This session is in use by another attachment.",
            ));
        }
        if after > self.sequence {
            return Err(RuntimeError::new(
                "INVALID_PARAMS",
                "Output cursor is ahead of this session.",
            ));
        }
        let id = new_id()?;
        self.attachment = Some(Attachment {
            id: id.clone(),
            acknowledged: after,
            sent: after,
            outstanding: VecDeque::new(),
        });
        Ok(id)
    }

    pub(super) fn controller(&self, id: &str) -> Result<(), RuntimeError> {
        if self
            .attachment
            .as_ref()
            .is_some_and(|attachment| attachment.id == id)
        {
            Ok(())
        } else {
            Err(RuntimeError::new(
                "SCOPE_DENIED",
                "This attachment no longer controls the session.",
            ))
        }
    }

    pub(super) fn detach(&mut self, id: &str) -> Result<(), RuntimeError> {
        self.controller(id)?;
        self.attachment = None;
        Ok(())
    }

    pub(super) fn acknowledge(&mut self, id: &str, sequence: u64) -> Result<(), RuntimeError> {
        self.controller(id)?;
        let attachment = self.attachment.as_mut().unwrap();
        if sequence < attachment.acknowledged || sequence > attachment.sent {
            return Err(RuntimeError::new(
                "INVALID_PARAMS",
                "Acknowledgement must name consumed output from this attachment.",
            ));
        }
        attachment.acknowledged = sequence;
        while attachment
            .outstanding
            .front()
            .is_some_and(|(cursor, _)| *cursor <= sequence)
        {
            attachment.outstanding.pop_front();
        }
        Ok(())
    }

    pub(super) fn page(&mut self, id: &str) -> Result<OutputPage, RuntimeError> {
        self.controller(id)?;
        let attachment = self.attachment.as_mut().unwrap();
        let first = self
            .retained
            .front()
            .map_or(self.sequence + 1, |frame| frame.sequence);
        let history_gap = attachment.sent < first - 1;
        if history_gap {
            attachment.sent = first - 1;
        }
        let mut pending: usize = attachment.outstanding.iter().map(|(_, bytes)| *bytes).sum();
        let mut frames = Vec::new();
        for frame in self
            .retained
            .iter()
            .filter(|frame| frame.sequence > attachment.sent)
        {
            if frames.len() >= 64 || attachment.outstanding.len() >= 4096 {
                break;
            }
            if pending + frame.bytes.len() > MAX_UNACKNOWLEDGED_BYTES {
                break;
            }
            // One transport page also fits in one bounded output payload.
            if frames
                .iter()
                .map(|frame: &OutputFrame| frame.bytes.len())
                .sum::<usize>()
                + frame.bytes.len()
                > MAX_SESSION_FRAME_BYTES
            {
                break;
            }
            pending += frame.bytes.len();
            attachment
                .outstanding
                .push_back((frame.sequence, frame.bytes.len()));
            frames.push(frame.clone());
        }
        if let Some(frame) = frames.last() {
            attachment.sent = frame.sequence;
        }
        Ok(OutputPage {
            history_gap,
            next_sequence: attachment.sent,
            last_sequence: self.sequence,
            frames,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn flood_retention_acknowledgements_and_attachment_ownership_are_bounded() {
        let mut output = Output::default();
        for _ in 0..100 {
            output.push(&vec![0xff; MAX_SESSION_FRAME_BYTES]).unwrap();
        }
        assert_eq!(output.retained_bytes, MAX_RETAINED_BYTES);
        assert_eq!(output.retained.len(), 64);
        let id = output.attach(0).unwrap();
        assert!(output.attach(0).is_err());
        let first = output.page(&id).unwrap();
        assert!(first.history_gap);
        assert_eq!(first.last_sequence, 100);
        assert_eq!(first.frames[0].sequence, 37);
        for _ in 1..16 {
            assert_eq!(output.page(&id).unwrap().frames.len(), 1);
        }
        let blocked = output.page(&id).unwrap();
        assert!(blocked.frames.is_empty());
        assert!(blocked.next_sequence < blocked.last_sequence);
        assert!(output.acknowledge(&id, 100).is_err());
        output.acknowledge(&id, 52).unwrap();
        assert_eq!(output.page(&id).unwrap().frames[0].sequence, 53);
        output.detach(&id).unwrap();
        let replacement = output.attach(52).unwrap();
        assert_ne!(replacement, id);
        assert!(output.controller(&id).is_err());
        assert!(output.page(&id).is_err());
    }
}
