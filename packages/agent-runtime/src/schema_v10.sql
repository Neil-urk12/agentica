-- MCP tools for the canvas agent. Servers are configured once per workspace store and
-- start only when enabled; a tool can be enabled only when the server reports it read-only.
CREATE TABLE mcp_server (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    transport TEXT NOT NULL CHECK (transport IN ('stdio')),
    command TEXT NOT NULL,
    args TEXT NOT NULL CHECK (json_valid(args)),
    env TEXT NOT NULL CHECK (json_valid(env)),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1))
) STRICT;

CREATE TABLE mcp_tool (
    server_id TEXT NOT NULL REFERENCES mcp_server(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    input_schema TEXT NOT NULL CHECK (json_valid(input_schema)),
    read_only INTEGER NOT NULL CHECK (read_only IN (0, 1)),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    CHECK (read_only = 1 OR enabled = 0),
    PRIMARY KEY (server_id, name)
) STRICT;

-- One row per finished call: metadata only, never arguments or results.
CREATE TABLE mcp_call (
    turn_id TEXT NOT NULL REFERENCES conversation_turn(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    server_name TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ok', 'error', 'timeout')),
    bytes INTEGER NOT NULL CHECK (bytes >= 0),
    PRIMARY KEY (turn_id, sequence)
) STRICT;
