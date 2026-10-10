import { z } from "zod";

export const RuntimeRequestSchema = z.strictObject({
  protocolVersion: z.literal(1),
  id: z.string().min(1).max(128),
  method: z.literal("runtime.ping"),
});

export const RuntimeResponseSchema = z.union([
  z.strictObject({
    protocolVersion: z.literal(1),
    id: z.string().min(1).max(128),
    result: z.strictObject({ status: z.literal("ok") }),
  }),
  z.strictObject({
    protocolVersion: z.literal(1),
    id: z.null(),
    error: z.strictObject({
      code: z.enum(["INVALID_JSON", "INVALID_REQUEST"]),
      message: z.string(),
    }),
  }),
]);

export type RuntimeRequest = z.infer<typeof RuntimeRequestSchema>;
export type RuntimeResponse = z.infer<typeof RuntimeResponseSchema>;
