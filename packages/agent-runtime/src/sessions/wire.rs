use super::*;

pub const MAX_SESSION_WIRE_BYTES: usize = 96 * 1024;
pub const MAX_SESSION_CONNECTIONS: usize = 16;
pub const MAX_CONNECTION_SUBSCRIPTIONS: usize = 8;
pub const MAX_SESSION_MESSAGES_PER_SECOND: usize = 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionRequest {
    pub id: String,
    pub command: SessionCommand,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "op",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum SessionCommand {
    Capabilities,
    List {
        workspace_id: String,
        canvas_id: Option<String>,
    },
    Status {
        owner: SessionOwner,
    },
    Start {
        owner: SessionOwner,
        request_id: String,
        rows: u16,
        cols: u16,
    },
    Subscribe {
        owner: SessionOwner,
        session_id: String,
        after: u64,
    },
    Input {
        owner: SessionOwner,
        session_id: String,
        attachment_id: String,
        bytes: Vec<u8>,
    },
    Resize {
        owner: SessionOwner,
        session_id: String,
        attachment_id: String,
        rows: u16,
        cols: u16,
        #[serde(default)]
        redraw: bool,
    },
    Acknowledge {
        owner: SessionOwner,
        session_id: String,
        attachment_id: String,
        sequence: u64,
    },
    Detach {
        owner: SessionOwner,
        session_id: String,
        attachment_id: String,
    },
    Focus {
        owner: SessionOwner,
        session_id: String,
        attachment_id: String,
        focused: bool,
    },
    ClearAttention {
        owner: SessionOwner,
        session_id: String,
        sequence: u64,
    },
    Stop {
        owner: SessionOwner,
        session_id: String,
    },
    Restart {
        owner: SessionOwner,
        session_id: String,
        request_id: String,
        rows: u16,
        cols: u16,
    },
}

impl SessionRequest {
    pub fn parse(bytes: &[u8]) -> Result<Self, RuntimeError> {
        if bytes.len() > MAX_SESSION_WIRE_BYTES {
            return Err(RuntimeError::new(
                "FRAME_TOO_LARGE",
                "Session messages must fit in 96 KiB including encoding.",
            ));
        }
        let request: Self = serde_json::from_slice(bytes)
            .map_err(|_| RuntimeError::new("INVALID_PARAMS", "Invalid session message."))?;
        if request.id.is_empty() || request.id.encode_utf16().count() > 128 {
            return Err(RuntimeError::new(
                "INVALID_PARAMS",
                "Session requests require an ID of 1–128 characters.",
            ));
        }
        request.command.validate()?;
        Ok(request)
    }
}

impl SessionCommand {
    pub fn owner(&self) -> Option<&SessionOwner> {
        match self {
            Self::Capabilities | Self::List { .. } => None,
            Self::Status { owner }
            | Self::Start { owner, .. }
            | Self::Subscribe { owner, .. }
            | Self::Input { owner, .. }
            | Self::Resize { owner, .. }
            | Self::Acknowledge { owner, .. }
            | Self::Detach { owner, .. }
            | Self::Focus { owner, .. }
            | Self::ClearAttention { owner, .. }
            | Self::Stop { owner, .. }
            | Self::Restart { owner, .. } => Some(owner),
        }
    }

    pub fn attachment(&self) -> Option<(&SessionOwner, &str, &str)> {
        match self {
            Self::Input {
                owner,
                session_id,
                attachment_id,
                ..
            }
            | Self::Resize {
                owner,
                session_id,
                attachment_id,
                ..
            }
            | Self::Acknowledge {
                owner,
                session_id,
                attachment_id,
                ..
            }
            | Self::Focus {
                owner,
                session_id,
                attachment_id,
                ..
            }
            | Self::Detach {
                owner,
                session_id,
                attachment_id,
            } => Some((owner, session_id, attachment_id)),
            _ => None,
        }
    }

    pub fn validate(&self) -> Result<(), RuntimeError> {
        let invalid = || {
            RuntimeError::new(
                "INVALID_PARAMS",
                "Invalid session identity, cursor, dimensions, or payload.",
            )
        };
        if let Some(owner) = self.owner() {
            owner.validate()?;
        }
        if let Some((_, session, attachment)) = self.attachment() {
            if !is_id(session) || !is_id(attachment) {
                return Err(invalid());
            }
        }
        match self {
            Self::List {
                workspace_id,
                canvas_id,
            } if !is_id(workspace_id) || canvas_id.as_ref().is_some_and(|id| !is_id(id)) => {
                return Err(invalid())
            }
            Self::Start {
                request_id,
                rows,
                cols,
                ..
            }
            | Self::Restart {
                request_id,
                rows,
                cols,
                ..
            } => {
                process::dimensions(*rows, *cols)?;
                if request_id.is_empty() || request_id.encode_utf16().count() > 128 {
                    return Err(invalid());
                }
            }
            Self::Input { bytes, .. }
                if bytes.is_empty() || bytes.len() > MAX_SESSION_FRAME_BYTES =>
            {
                return Err(invalid())
            }
            Self::Resize { rows, cols, .. } => {
                process::dimensions(*rows, *cols)?;
            }
            Self::Subscribe { after, .. } if *after > (1 << 53) - 1 => return Err(invalid()),
            Self::Acknowledge { sequence, .. } | Self::ClearAttention { sequence, .. }
                if *sequence > (1 << 53) - 1 =>
            {
                return Err(invalid())
            }
            _ => {}
        }
        match self {
            Self::Subscribe { session_id, .. }
            | Self::ClearAttention { session_id, .. }
            | Self::Stop { session_id, .. }
            | Self::Restart { session_id, .. }
                if !is_id(session_id) =>
            {
                Err(invalid())
            }
            _ => Ok(()),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEvent {
    pub event: &'static str,
    pub owner: SessionOwner,
    pub session_id: String,
    pub attachment_id: String,
    pub status: SessionStatus,
    pub output: OutputPage,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn attention_commands_validate_identity_controller_and_sequence() {
        let id = crate::store::new_id().unwrap();
        let owner = json!({"workspaceId": id, "canvasId": id, "tileId": id});
        let parse = |command| {
            SessionRequest::parse(
                &serde_json::to_vec(&json!({"id": "test", "command": command})).unwrap(),
            )
        };
        let focus = json!({"op": "focus", "owner": owner, "sessionId": id, "attachmentId": id, "focused": true});
        assert!(parse(focus.clone()).unwrap().command.attachment().is_some());
        for (field, value) in [
            ("attachmentId", json!("invalid")),
            ("focused", json!(1)),
            ("sessionId", json!("invalid")),
        ] {
            let mut invalid = focus.clone();
            invalid[field] = value;
            assert!(parse(invalid).is_err());
        }
        let clear = json!({"op": "clearAttention", "owner": owner, "sessionId": id, "sequence": 2});
        assert!(parse(clear.clone()).is_ok());
        for sequence in [json!(-1), json!(1u64 << 53), json!(1.5)] {
            let mut invalid = clear.clone();
            invalid["sequence"] = sequence;
            assert!(parse(invalid).is_err());
        }
    }
}
