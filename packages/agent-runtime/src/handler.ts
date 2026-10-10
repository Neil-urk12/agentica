import { RuntimeRequestSchema, type RuntimeResponse } from "@agentica/protocol";

export function handleLine(line: string): RuntimeResponse {
  let input: unknown;

  try {
    input = JSON.parse(line);
  } catch {
    return {
      protocolVersion: 1,
      id: null,
      error: { code: "INVALID_JSON", message: "Expected a JSON request." },
    };
  }

  const request = RuntimeRequestSchema.safeParse(input);

  if (!request.success) {
    return {
      protocolVersion: 1,
      id: null,
      error: {
        code: "INVALID_REQUEST",
        message: "Expected protocol version 1, an id, and runtime.ping.",
      },
    };
  }

  return {
    protocolVersion: 1,
    id: request.data.id,
    result: { status: "ok" },
  };
}
