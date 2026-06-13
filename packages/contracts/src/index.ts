import { z } from "zod";
import {
  ApprovalRequest,
  Decision,
  RoomView,
  SpanRecord,
  StaffPingKind,
  StaffResponse,
} from "./domain.js";

export * from "./domain.js";

/**
 * The single source of truth for everything that crosses the WebSocket, in
 * both directions. Both apps/web (operator console) and apps/server import
 * these schemas, so the wire format is validated at runtime AND type-checked
 * at compile time on both ends.
 */

// ---------------------------------------------------------------------------
// Client (operator console / dev controls) -> Server
// ---------------------------------------------------------------------------

/** Dev/sim control actions that drive the in-memory room service. */
export const RoomControl = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("solve_puzzle"), puzzleId: z.string() }),
  z.object({ action: z.literal("reset") }),
]);
export type RoomControl = z.infer<typeof RoomControl>;

export const ClientEvent = z.discriminatedUnion("type", [
  // A (transcribed) player line — "Hey Warden, can we have a hint?". Real
  // mic/STT is a pluggable adapter; here it arrives as text.
  z.object({ type: z.literal("player_utterance"), roomId: z.string(), text: z.string().min(1) }),
  // A human GM's response to an approval_request.
  z.object({
    type: z.literal("operator_decision"),
    approvalId: z.string(),
    decision: Decision,
    note: z.string().optional(),
  }),
  // Drive the simulated room (start, mark a puzzle solved, reset).
  z.object({ type: z.literal("room_control"), roomId: z.string(), control: RoomControl }),
  // Operator raises the per-session response / cost budget (top-up).
  z.object({
    type: z.literal("budget_topup"),
    roomId: z.string(),
    responses: z.number().optional(),
    costUsd: z.number().optional(),
  }),
  // Staff respond to a ping: "acknowledged" (on the way) or "resolved" (handled).
  z.object({ type: z.literal("staff_respond"), pingId: z.string(), response: StaffResponse }),
  // Cancel an in-flight Warden run.
  z.object({ type: z.literal("cancel"), runId: z.string() }),
]);
export type ClientEvent = z.infer<typeof ClientEvent>;

// ---------------------------------------------------------------------------
// Server -> Client (operator console)
// ---------------------------------------------------------------------------

export const ServerEvent = z.discriminatedUnion("type", [
  // What the players said out loud (echoed to all consoles so operators see it).
  z.object({ type: z.literal("player_message"), roomId: z.string(), text: z.string() }),
  // Warden's player-facing output, AFTER the output guardrail has screened it.
  z.object({ type: z.literal("team_message"), roomId: z.string(), text: z.string() }),
  // A risky action (skip_puzzle / extend_timer) awaiting a human decision.
  z.object({ type: z.literal("approval_request"), request: ApprovalRequest }),
  // Notify staff — on player request or on error/budget breach. Deduplicated
  // per (room, kind): repeated pings bump `count` rather than stacking up.
  z.object({
    type: z.literal("staff_ping"),
    id: z.string(),
    roomId: z.string(),
    kind: StaffPingKind,
    reason: z.string(),
    count: z.number(),
  }),
  // A staff member responded to a ping — broadcast so every console updates it.
  z.object({ type: z.literal("staff_update"), pingId: z.string(), response: StaffResponse }),
  // One OpenTelemetry span, for the live observability panel.
  z.object({ type: z.literal("observability"), span: SpanRecord }),
  // Pushed room state (operator-safe projection).
  z.object({ type: z.literal("room_state"), room: RoomView }),
  // Per-session budget usage + limits, for the operator to see and top up.
  z.object({
    type: z.literal("budget"),
    roomId: z.string(),
    responsesUsed: z.number(),
    responsesLimit: z.number(),
    costUsd: z.number(),
    costLimit: z.number(),
  }),
  z.object({ type: z.literal("error"), roomId: z.string().optional(), message: z.string() }),
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
