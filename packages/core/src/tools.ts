import { tool } from "ai";
import { z } from "zod";
import { runTool } from "./policy.js";
import type { RunContext } from "./types.js";

/**
 * Model-facing tool definitions. Every `execute` delegates to the single gate
 * (runTool) — the tools themselves contain no policy, so the allow-list,
 * cooldowns, and approval gate can't be bypassed.
 */
export function makeTools(ctx: RunContext) {
  return {
    get_room_state: tool({
      description:
        "Check which puzzles are solved or unsolved and the safe hints available for unsolved ones. Use before deciding whether or how to help.",
      inputSchema: z.object({}),
      execute: async () => runTool(ctx, "get_room_state", {}),
    }),
    get_elapsed_time: tool({
      description:
        "Check how much wall-clock time has elapsed since the room started, and the total time limit.",
      inputSchema: z.object({}),
      execute: async () => runTool(ctx, "get_elapsed_time", {}),
    }),
    ping_staff: tool({
      description:
        "Summon human staff — when players explicitly ask for a person, or something seems wrong.",
      inputSchema: z.object({
        reason: z.string().describe("Why staff are needed."),
      }),
      execute: async (input) => runTool(ctx, "ping_staff", input),
    }),
    skip_puzzle: tool({
      description:
        "Skip a puzzle (mark it solved) so the team can move on. RISKY: requires human Game Master approval before it takes effect.",
      inputSchema: z.object({
        puzzleId: z.string().describe("The puzzle's id, exactly as shown by get_room_state (e.g. \"p3\")."),
        reason: z.string().describe("Why skipping is warranted."),
      }),
      execute: async (input) => runTool(ctx, "skip_puzzle", input),
    }),
    extend_timer: tool({
      description:
        "Add minutes to the room timer. RISKY: requires human Game Master approval before it takes effect.",
      inputSchema: z.object({
        minutes: z.number().describe("Minutes to add."),
        reason: z.string().describe("Why extending is warranted."),
      }),
      execute: async (input) => runTool(ctx, "extend_timer", input),
    }),
  };
}
