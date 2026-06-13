import { z } from "zod";

/**
 * Domain model for the escape-room Game Master. Shared by core (tools read
 * sensors / take actions against it), server (the simulated room service owns
 * the live state), and web (the operator console renders it).
 */

export const Puzzle = z.object({
  id: z.string(),
  name: z.string(),
  /**
   * The full solution. Lives server-side only and is used by the OUTPUT
   * guardrail to ensure Warden never leaks it to the team. Never sent to the
   * operator console for unsolved puzzles.
   */
  solution: z.string(),
  /**
   * A graduated hint ladder (gentle nudge -> stronger). SAFE for Warden to
   * see and draw from — unlike `solution`, which it must never receive or leak.
   */
  hints: z.array(z.string()),
  solved: z.boolean(),
  solvedAt: z.number().optional(),
});
export type Puzzle = z.infer<typeof Puzzle>;

/** A puzzle as shown to the operator — solution stripped for unsolved ones. */
export const PuzzleView = Puzzle.omit({ solution: true }).extend({
  /** Present only once solved, so the console can show what was solved. */
  solution: z.string().optional(),
});
export type PuzzleView = z.infer<typeof PuzzleView>;

export const RoomStatus = z.enum(["pending", "running", "ended"]);
export type RoomStatus = z.infer<typeof RoomStatus>;

/** How a room ended — a win (all solved) or the clock running out. */
export const RoomOutcome = z.enum(["solved", "timed_out"]);
export type RoomOutcome = z.infer<typeof RoomOutcome>;

export const RoomSession = z.object({
  id: z.string(),
  name: z.string(),
  puzzles: z.array(Puzzle),
  /** epoch ms when the room started; null while pending. */
  startedAt: z.number().nullable(),
  /** epoch ms when the room ended; null until then. Freezes the clock. */
  endedAt: z.number().nullable(),
  /** How it ended; null while pending/running. */
  outcome: RoomOutcome.nullable(),
  durationMs: z.number(),
  status: RoomStatus,
});
export type RoomSession = z.infer<typeof RoomSession>;

/** The operator-safe projection of a room (no unsolved-puzzle solutions). */
export const RoomView = RoomSession.omit({ puzzles: true, endedAt: true }).extend({
  puzzles: z.array(PuzzleView),
  elapsedMs: z.number(),
});
export type RoomView = z.infer<typeof RoomView>;

/** A risky action awaiting a human GM's decision. */
export const ApprovalRequest = z.object({
  approvalId: z.string(),
  roomId: z.string(),
  tool: z.string(),
  input: z.unknown(),
  reason: z.string(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

export const Decision = z.enum(["allow", "deny"]);
export type Decision = z.infer<typeof Decision>;

/** Why staff were paged — used to deduplicate pings per room. */
export const StaffPingKind = z.enum(["human_request", "budget", "guardrail", "error"]);
export type StaffPingKind = z.infer<typeof StaffPingKind>;

/**
 * A staff member's response to a ping. `acknowledged` = seen it, on the way (the
 * ping stays open / en route). `resolved` = visited and handled (ping closes).
 */
export const StaffResponse = z.enum(["acknowledged", "resolved"]);
export type StaffResponse = z.infer<typeof StaffResponse>;

/** One OpenTelemetry span, projected for the live operator console. */
export const SpanRecord = z.object({
  id: z.string(),
  roomId: z.string(),
  name: z.string(),
  kind: z.enum(["model", "tool", "guardrail"]),
  durationMs: z.number(),
  status: z.enum(["ok", "error", "denied"]),
  tokensIn: z.number().optional(),
  tokensOut: z.number().optional(),
  costUsd: z.number().optional(),
  error: z.string().optional(),
});
export type SpanRecord = z.infer<typeof SpanRecord>;
