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
