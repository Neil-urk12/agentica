import { isTauri, invoke } from "@tauri-apps/api/core";
import {
  MAX_FRAME_BYTES,
  ResultSchemas,
  RuntimeRequestSchema,
  RuntimeResponseSchema,
  type RuntimeErrorCode,
  type RuntimeMethod,
  type RuntimeParams,
  type RuntimeRequest,
  type RuntimeResult,
} from "@agentica/protocol";

export const desktopMode = isTauri();

/** A runtime error; `code` is absent for transport and validation failures. */
export class RuntimeCallError extends Error {
  constructor(
    message: string,
    readonly code?: RuntimeErrorCode,
  ) {
    super(message);
  }
}

type ParamsFor<M extends RuntimeMethod> = M extends keyof typeof ResultSchemas
  ? M extends "runtime.ping"
    ? []
    : [params: RuntimeParams<Exclude<M, "runtime.ping">>]
  : never;

/** Send one validated request through the desktop or detached transport. */
export async function callRuntime<M extends RuntimeMethod>(
  connectionKey: string,
  connect: boolean,
  method: M,
  ...[params]: ParamsFor<M>
): Promise<RuntimeResult<M>> {
  const request = {
    protocolVersion: 1,
    id: crypto.randomUUID(),
    method,
    ...(params === undefined ? {} : { params }),
  } as RuntimeRequest;
  if (!RuntimeRequestSchema.safeParse(request).success)
    throw new RuntimeCallError("The request is invalid and was not sent.");
  const body = JSON.stringify(request);
  if (new TextEncoder().encode(body).length > MAX_FRAME_BYTES)
    throw new RuntimeCallError(
      "The change is larger than 16 KiB and was not sent.",
    );
  let reply: unknown;
  if (desktopMode) {
    reply = await invoke("runtime_request", { request, connect });
  } else {
    const response = await fetch("http://127.0.0.1:1421/rpc", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${connectionKey}`,
      },
      body,
      signal: method === "runtime.ping" ? AbortSignal.timeout(3000) : undefined,
      cache: "no-store",
    });
    if (!response.ok) throw new RuntimeCallError(await response.text());
    reply = await response.json();
  }
  const parsed = RuntimeResponseSchema.safeParse(reply);
  if (!parsed.success)
    throw new RuntimeCallError(
      "The backend returned an invalid protocol response.",
    );
  const response = parsed.data;
  if (response.id !== null && response.id !== request.id)
    throw new RuntimeCallError("The backend returned an unrelated response.");
  if ("error" in response)
    throw new RuntimeCallError(response.error.message, response.error.code);
  const result = ResultSchemas[method].safeParse(response.result);
  if (!result.success)
    throw new RuntimeCallError(
      "The backend returned an invalid protocol response.",
    );
  return result.data as RuntimeResult<M>;
}

export async function pingRuntime(connectionKey: string, connect: boolean) {
  await callRuntime(connectionKey, connect, "runtime.ping");
}
