//! MCP server configuration, tool flags, and the per-turn call log.
//!
//! Only database state lives here. Processes belong to `crate::mcp`, which reaches this module
//! through `Runtime::mcp_internal`; the `mcp.internal.*` methods return launch secrets and are
//! never listed in `METHODS`, so they cannot be called over RPC.
use super::*;
use std::collections::BTreeMap;

const MAX_SERVERS: i64 = 32;
const MAX_NAME: usize = 32;
const MAX_COMMAND: usize = 512;
const MAX_ARGS: usize = 32;
const MAX_ARG: usize = 1024;
const MAX_ENV: usize = 32;
const MAX_ENV_KEY: usize = 128;
const MAX_ENV_VALUE: usize = 4096;
pub(crate) const MAX_TOOLS: usize = 128;
const MAX_TOOL_NAME: usize = 128;
const MAX_DESCRIPTION: usize = 512;
const MAX_SCHEMA: usize = 16 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Workspace {
    workspace_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Create {
    workspace_id: String,
    name: String,
    command: String,
    args: Vec<String>,
    env: BTreeMap<String, String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Update {
    workspace_id: String,
    server_id: String,
    name: Option<String>,
    command: Option<String>,
    args: Option<Vec<String>>,
    /// Replaces every variable; absent keeps them, since values are never returned.
    env: Option<BTreeMap<String, String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ServerRef {
    workspace_id: String,
    server_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Flag {
    workspace_id: String,
    server_id: String,
    enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ToolFlag {
    workspace_id: String,
    server_id: String,
    tool: String,
    enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Store {
    workspace_id: String,
    server_id: String,
    tools: Vec<StoredTool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredTool {
    name: String,
    description: String,
    input_schema: Value,
    read_only: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Authorize {
    workspace_id: String,
    canvas_id: String,
    turn_id: String,
    server: String,
    tool: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Record {
    workspace_id: String,
    turn_id: String,
    server: String,
    tool: String,
    status: String,
    bytes: i64,
}

// Zod 4 measures string length in code points (verified with zod 4.6.5), like `chars()`.
fn units(value: &str) -> usize {
    value.chars().count()
}

fn valid_name(name: &str) -> Result<(), RuntimeError> {
    let ok = !name.is_empty()
        && units(name) <= MAX_NAME
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !name.starts_with('-');
    if ok {
        Ok(())
    } else {
        Err(invalid(
            "name must be 1 to 32 lowercase letters, digits, or hyphens, and not start with a hyphen.",
        ))
    }
}

fn valid_launch(
    command: &str,
    args: &[String],
    env: &BTreeMap<String, String>,
) -> Result<(), RuntimeError> {
    if command.trim().is_empty() || units(command) > MAX_COMMAND || command.contains('\0') {
        return Err(invalid("command must contain 1 to 512 characters."));
    }
    if args.len() > MAX_ARGS || args.iter().any(|a| units(a) > MAX_ARG || a.contains('\0')) {
        return Err(invalid(
            "Use at most 32 arguments of up to 1024 characters.",
        ));
    }
    let key_ok = |k: &str| {
        !k.is_empty()
            && units(k) <= MAX_ENV_KEY
            && !k.as_bytes()[0].is_ascii_digit()
            && k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
    };
    if env.len() > MAX_ENV
        || env
            .iter()
            .any(|(k, v)| !key_ok(k) || units(v) > MAX_ENV_VALUE || v.contains('\0'))
    {
        return Err(invalid(
            "Use at most 32 variables with letter/digit/underscore names and values up to 4096 characters.",
        ));
    }
    Ok(())
}

fn exists(tx: &Transaction, server_id: &str) -> Result<bool, RuntimeError> {
    Ok(tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM mcp_server WHERE id = ?1)",
        [server_id],
        |r| r.get(0),
    )?)
}

fn require(tx: &Transaction, server_id: &str) -> Result<(), RuntimeError> {
    id("serverId", server_id)?;
    if exists(tx, server_id)? {
        Ok(())
    } else {
        Err(not_found("MCP server"))
    }
}

fn name_taken(tx: &Transaction, name: &str, except: &str) -> Result<bool, RuntimeError> {
    Ok(tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM mcp_server WHERE name = ?1 AND id <> ?2)",
        (name, except),
        |r| r.get(0),
    )?)
}

fn parse_json(text: String) -> Value {
    serde_json::from_str(&text).unwrap_or(Value::Null)
}

/// The server as clients see it: environment names only, never values.
fn view(tx: &Transaction, server_id: &str) -> Result<Value, RuntimeError> {
    let (name, command, args, env, enabled): (String, String, String, String, bool) = tx
        .query_row(
            "SELECT name, command, args, env, enabled FROM mcp_server WHERE id = ?1",
            [server_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )?;
    let env_keys: Vec<String> = parse_json(env)
        .as_object()
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default();
    let mut statement = tx.prepare(
        "SELECT name, description, read_only, enabled FROM mcp_tool WHERE server_id = ?1 ORDER BY name",
    )?;
    let tools = statement
        .query_map([server_id], |r| {
            Ok(json!({
                "name": r.get::<_, String>(0)?,
                "description": r.get::<_, String>(1)?,
                "readOnly": r.get::<_, bool>(2)?,
                "enabled": r.get::<_, bool>(3)?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({
        "id": server_id, "name": name, "transport": "stdio", "command": command,
        "args": parse_json(args), "envKeys": env_keys, "enabled": enabled, "tools": tools,
    }))
}

fn launch(tx: &Transaction, server_id: &str) -> Result<Value, RuntimeError> {
    let (name, command, args, env, enabled): (String, String, String, String, bool) = tx
        .query_row(
            "SELECT name, command, args, env, enabled FROM mcp_server WHERE id = ?1",
            [server_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )?;
    Ok(
        json!({ "serverId": server_id, "name": name, "command": command, "args": parse_json(args),
            "env": parse_json(env), "enabled": enabled }),
    )
}

pub(super) fn call(tx: &Transaction, method: &str, params: Value) -> Result<Value, RuntimeError> {
    match method {
        "mcp.server.list" => {
            let p: Workspace = parse(params)?;
            id("workspaceId", &p.workspace_id)?;
            let mut statement = tx.prepare("SELECT id FROM mcp_server ORDER BY name")?;
            let ids = statement
                .query_map([], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            let servers = ids
                .iter()
                .map(|server_id| view(tx, server_id))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(json!({ "servers": servers }))
        }
        "mcp.server.create" => {
            let p: Create = parse(params)?;
            id("workspaceId", &p.workspace_id)?;
            valid_name(&p.name)?;
            valid_launch(&p.command, &p.args, &p.env)?;
            let count: i64 = tx.query_row("SELECT count(*) FROM mcp_server", [], |r| r.get(0))?;
            if count >= MAX_SERVERS {
                return Err(invalid("Remove a server before adding another (limit 32)."));
            }
            let server_id = new_id()?;
            if name_taken(tx, &p.name, &server_id)? {
                return Err(RuntimeError::new(
                    "CONFLICT",
                    "A server with this name already exists.",
                ));
            }
            tx.execute(
                "INSERT INTO mcp_server(id, name, transport, command, args, env) VALUES (?1, ?2, 'stdio', ?3, ?4, ?5)",
                (&server_id, &p.name, &p.command, json!(p.args).to_string(), json!(p.env).to_string()),
            )?;
            Ok(json!({ "server": view(tx, &server_id)? }))
        }
        "mcp.server.update" => {
            let p: Update = parse(params)?;
            id("workspaceId", &p.workspace_id)?;
            require(tx, &p.server_id)?;
            let enabled: bool = tx.query_row(
                "SELECT enabled FROM mcp_server WHERE id = ?1",
                [&p.server_id],
                |r| r.get(0),
            )?;
            if enabled {
                return Err(RuntimeError::new(
                    "CONFLICT",
                    "Turn the server off before editing it.",
                ));
            }
            let (name, command, args, env): (String, String, String, String) = tx.query_row(
                "SELECT name, command, args, env FROM mcp_server WHERE id = ?1",
                [&p.server_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )?;
            let name = p.name.unwrap_or(name);
            let command = p.command.unwrap_or(command);
            let args: Vec<String> = p
                .args
                .unwrap_or_else(|| serde_json::from_str(&args).unwrap_or_default());
            let env: BTreeMap<String, String> = p
                .env
                .unwrap_or_else(|| serde_json::from_str(&env).unwrap_or_default());
            valid_name(&name)?;
            valid_launch(&command, &args, &env)?;
            if name_taken(tx, &name, &p.server_id)? {
                return Err(RuntimeError::new(
                    "CONFLICT",
                    "A server with this name already exists.",
                ));
            }
            tx.execute(
                "UPDATE mcp_server SET name = ?2, command = ?3, args = ?4, env = ?5 WHERE id = ?1",
                (
                    &p.server_id,
                    &name,
                    &command,
                    json!(args).to_string(),
                    json!(env).to_string(),
                ),
            )?;
            // A changed command may expose different tools; they are listed again on enable.
            tx.execute("DELETE FROM mcp_tool WHERE server_id = ?1", [&p.server_id])?;
            Ok(json!({ "server": view(tx, &p.server_id)? }))
        }
        "mcp.server.delete" => {
            let p: ServerRef = parse(params)?;
            id("workspaceId", &p.workspace_id)?;
            require(tx, &p.server_id)?;
            tx.execute("DELETE FROM mcp_server WHERE id = ?1", [&p.server_id])?;
            Ok(json!({}))
        }
        "mcp.tool.set_enabled" => {
            let p: ToolFlag = parse(params)?;
            id("workspaceId", &p.workspace_id)?;
            require(tx, &p.server_id)?;
            let read_only: Option<bool> = tx
                .query_row(
                    "SELECT read_only FROM mcp_tool WHERE server_id = ?1 AND name = ?2",
                    (&p.server_id, &p.tool),
                    |r| r.get(0),
                )
                .optional()?;
            let Some(read_only) = read_only else {
                return Err(not_found("MCP tool"));
            };
            if p.enabled && !read_only {
                return Err(RuntimeError::new(
                    "SCOPE_DENIED",
                    "Only tools the server reports as read-only can be enabled.",
                ));
            }
            tx.execute(
                "UPDATE mcp_tool SET enabled = ?3 WHERE server_id = ?1 AND name = ?2",
                (&p.server_id, &p.tool, p.enabled),
            )?;
            Ok(json!({ "server": view(tx, &p.server_id)? }))
        }
        "mcp.tools.list" => {
            let p: Workspace = parse(params)?;
            id("workspaceId", &p.workspace_id)?;
            let mut statement = tx.prepare(
                "SELECT s.name, t.name, t.description, t.input_schema
                 FROM mcp_tool t JOIN mcp_server s ON s.id = t.server_id
                 WHERE s.enabled = 1 AND t.enabled = 1 AND t.read_only = 1
                 ORDER BY s.name, t.name",
            )?;
            let tools = statement
                .query_map([], |r| {
                    Ok(json!({
                        "server": r.get::<_, String>(0)?,
                        "name": r.get::<_, String>(1)?,
                        "description": r.get::<_, String>(2)?,
                        "inputSchema": parse_json(r.get::<_, String>(3)?),
                    }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(json!({ "tools": tools }))
        }
        "mcp.internal.set_enabled" => {
            let p: Flag = parse(params)?;
            id("workspaceId", &p.workspace_id)?;
            require(tx, &p.server_id)?;
            tx.execute(
                "UPDATE mcp_server SET enabled = ?2 WHERE id = ?1",
                (&p.server_id, p.enabled),
            )?;
            Ok(json!({ "server": view(tx, &p.server_id)? }))
        }
        "mcp.internal.launch" => {
            let p: ServerRef = parse(params)?;
            id("workspaceId", &p.workspace_id)?;
            require(tx, &p.server_id)?;
            launch(tx, &p.server_id)
        }
        "mcp.internal.store_tools" => {
            let p: Store = parse(params)?;
            id("workspaceId", &p.workspace_id)?;
            require(tx, &p.server_id)?;
            let mut keep: Vec<&str> = Vec::new();
            for tool in p.tools.iter().take(MAX_TOOLS) {
                let schema = tool.input_schema.to_string();
                if tool.name.is_empty()
                    || units(&tool.name) > MAX_TOOL_NAME
                    || schema.len() > MAX_SCHEMA
                {
                    continue;
                }
                let description: String = tool.description.chars().take(MAX_DESCRIPTION).collect();
                // A tool that stopped being read-only is switched off, never left enabled.
                tx.execute(
                    "INSERT INTO mcp_tool(server_id, name, description, input_schema, read_only)
                     VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(server_id, name) DO UPDATE SET
                       description = excluded.description,
                       input_schema = excluded.input_schema,
                       read_only = excluded.read_only,
                       enabled = CASE WHEN excluded.read_only = 1 THEN enabled ELSE 0 END",
                    (
                        &p.server_id,
                        &tool.name,
                        description,
                        schema,
                        tool.read_only,
                    ),
                )?;
                keep.push(&tool.name);
            }
            let mut statement = tx.prepare("SELECT name FROM mcp_tool WHERE server_id = ?1")?;
            let stored = statement
                .query_map([&p.server_id], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            for name in stored.iter().filter(|n| !keep.contains(&n.as_str())) {
                tx.execute(
                    "DELETE FROM mcp_tool WHERE server_id = ?1 AND name = ?2",
                    (&p.server_id, name),
                )?;
            }
            Ok(json!({ "server": view(tx, &p.server_id)? }))
        }
        "mcp.internal.authorize" => {
            let p: Authorize = parse(params)?;
            id("workspaceId", &p.workspace_id)?;
            id("canvasId", &p.canvas_id)?;
            id("turnId", &p.turn_id)?;
            let status: Option<String> = tx
                .query_row(
                    "SELECT status FROM conversation_turn WHERE id = ?1 AND canvas_id = ?2",
                    (&p.turn_id, &p.canvas_id),
                    |r| r.get(0),
                )
                .optional()?;
            match status.as_deref() {
                None => return Err(not_found("Turn")),
                Some("generating") => {}
                Some(_) => {
                    return Err(RuntimeError::new(
                        "CONFLICT",
                        "This turn is no longer generating; tool calls are closed.",
                    ))
                }
            }
            // One message for every refusal, so a model cannot probe for disabled tools.
            let denied = || {
                RuntimeError::new(
                    "SCOPE_DENIED",
                    "That tool is not enabled. Only enabled read-only tools can be called.",
                )
            };
            let server_id: Option<String> = tx
                .query_row(
                    "SELECT s.id FROM mcp_server s JOIN mcp_tool t ON t.server_id = s.id
                     WHERE s.name = ?1 AND t.name = ?2
                       AND s.enabled = 1 AND t.enabled = 1 AND t.read_only = 1",
                    (&p.server, &p.tool),
                    |r| r.get(0),
                )
                .optional()?;
            launch(tx, &server_id.ok_or_else(denied)?)
        }
        "mcp.internal.record" => {
            let p: Record = parse(params)?;
            id("workspaceId", &p.workspace_id)?;
            id("turnId", &p.turn_id)?;
            if !matches!(p.status.as_str(), "ok" | "error" | "timeout") || p.bytes < 0 {
                return Err(invalid("Invalid call record."));
            }
            let sequence: i64 = tx.query_row(
                "SELECT count(*) + 1 FROM mcp_call WHERE turn_id = ?1",
                [&p.turn_id],
                |r| r.get(0),
            )?;
            tx.execute(
                "INSERT INTO mcp_call(turn_id, sequence, server_name, tool_name, status, bytes) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                (&p.turn_id, sequence, &p.server, &p.tool, &p.status, p.bytes),
            )?;
            Ok(json!({}))
        }
        _ => Err(invalid("Unknown MCP method.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_match_the_protocol() {
        let limits: Value =
            serde_json::from_str(include_str!("../../../tests/fixtures/mcp-limits.json")).unwrap();
        assert_eq!(
            limits,
            json!({
                "servers": MAX_SERVERS,
                "name": MAX_NAME,
                "command": MAX_COMMAND,
                "args": MAX_ARGS,
                "arg": MAX_ARG,
                "env": MAX_ENV,
                "envKey": MAX_ENV_KEY,
                "envValue": MAX_ENV_VALUE,
                "tools": MAX_TOOLS,
                "toolName": MAX_TOOL_NAME,
                "description": MAX_DESCRIPTION,
                "resultBytes": crate::mcp::RESULT_CAP,
            })
        );
    }
}
