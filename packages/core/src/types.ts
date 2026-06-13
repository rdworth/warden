import type { LanguageModel } from "ai";
import type { Decision, ServerEvent } from "@warden/contracts";

/**
 * Everything the GM harness needs is injected through RunContext, so core stays
 * transport-agnostic: the server backs these with the real room service + WS
 * approval round-trips; tests back them with fakes + a mock model.
 */

export interface RoomSensors {
  /** Model/operator-safe snapshot — names, solved flags, SAFE hints. No solutions. */
  snapshot(): {
    name: string;
    durationMs: number;
    elapsedMs: number;
    puzzles: { id: string; name: string; solved: boolean; hints: string[] }[];
  };
}

export interface RoomActions {
  pingStaff(reason: string): void;
  skipPuzzle(puzzleId: string): boolean;
  extendTimer(minutes: number): void;
}

export interface ApprovalAsk {
  tool: string;
  input: unknown;
  reason: string;
}

export interface PolicyConfig {
  /** Max Warden responses per session before it escalates to staff instead. */
  maxResponses: number;
  /** Max cumulative model spend (USD) per session before escalating. */
  maxCostUsd: number;
  /** Soft minimum gap between responses (tracked; informational in v1). */
  minResponseGapMs: number;
  /** Cooldown between staff pings. */
  pingCooldownMs: number;
}

export const DEFAULT_POLICY: PolicyConfig = {
  maxResponses: 20,
  maxCostUsd: 1.0,
  minResponseGapMs: 15_000,
  pingCooldownMs: 30_000,
};

export interface SessionBudget {
  responseCount: number;
  cumulativeCostUsd: number;
  lastResponseAt: number;
  lastPingAt: number;
}

export function newBudget(): SessionBudget {
  return {
    responseCount: 0,
    cumulativeCostUsd: 0,
    lastResponseAt: 0,
    lastPingAt: 0,
  };
}

export interface RunContext {
  roomId: string;
  /** Model id string, for cost lookup + telemetry. */
  modelId: string;
  /** The language model — injectable (a mock in tests). */
  model: LanguageModel;
  sensors: RoomSensors;
  actions: RoomActions;
  /** Risky actions await this — the server raises an approval_request and resolves on the human's decision. */
  requestApproval(ask: ApprovalAsk): Promise<Decision>;
  /** Output guardrail bound to this room (screens against unsolved solutions). */
  screen(text: string): { text: string; leaked: boolean };
  /** Push an event to the operator console / team channel. */
  emit(event: ServerEvent): void;
  policy: PolicyConfig;
  /** Mutable per-session budget state. */
  budget: SessionBudget;
}
