import { z } from "zod";

/**
 * The single source of truth for everything that crosses the WebSocket, in
 * both directions. Both `apps/web` (client) and `apps/server` (server) import
 * these schemas, so the wire format is validated at runtime AND type-checked
 * at compile time on both ends.
 */

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export const ClientEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user_message"), text: z.string().min(1) }),
  z.object({ type: z.literal("cancel"), runId: z.string() }),
]);
export type ClientEvent = z.infer<typeof ClientEvent>;

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export const ServerEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run_started"), runId: z.string() }),
  z.object({ type: z.literal("text_delta"), runId: z.string(), delta: z.string() }),
  z.object({
    type: z.literal("tool_call"),
    runId: z.string(),
    toolCallId: z.string(),
    name: z.string(),
    args: z.unknown(),
  }),
  z.object({
    type: z.literal("tool_result"),
    runId: z.string(),
    toolCallId: z.string(),
    result: z.unknown(),
  }),
  z.object({ type: z.literal("run_finished"), runId: z.string(), reason: z.string() }),
  z.object({ type: z.literal("error"), runId: z.string().optional(), message: z.string() }),
]);
export type ServerEvent = z.infer<typeof ServerEvent>;

// ---------------------------------------------------------------------------
// (de)serialization helpers — parse on the way in, validate on the way out
// ---------------------------------------------------------------------------

export function parseClientEvent(raw: string): ClientEvent {
  return ClientEvent.parse(JSON.parse(raw));
}

export function serializeServerEvent(event: ServerEvent): string {
  return JSON.stringify(ServerEvent.parse(event));
}
