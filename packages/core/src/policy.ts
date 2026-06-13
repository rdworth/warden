import { randomUUID } from "node:crypto";
import { startSpan } from "./telemetry.js";
import type { RunContext } from "./types.js";

/**
 * THE single Action chokepoint. Every tool the model calls goes through
 * `runTool`, which classifies it and enforces — in code, not in the prompt —
 * the allow-list, the staff-ping cooldown, and the human-approval gate for
 * risky actions. Each call is wrapped in an OpenTelemetry span.
 */

type Kind = "read" | "action" | "risky";

const KIND: Record<string, Kind> = {
  get_room_state: "read",
  get_elapsed_time: "read",
  ping_staff: "action",
  skip_puzzle: "risky",
  extend_timer: "risky",
};

export async function runTool(
  ctx: RunContext,
  tool: string,
  input: Record<string, unknown>,
): Promise<string> {
  const kind = KIND[tool];
  if (!kind) return `Unknown tool: ${tool}`;

  const span = startSpan(ctx.roomId, `tool.${tool}`, "tool");
  try {
    // Approval gate — risky actions cannot run without a human "allow".
    if (kind === "risky") {
      const decision = await ctx.requestApproval({
        tool,
        input,
        reason: String(input.reason ?? "risky action"),
      });
      if (decision !== "allow") {
        ctx.emit({ type: "observability", span: span.end({ status: "denied" }) });
        return `The human Game Master DENIED ${tool}. Do not attempt it again — help the team another way.`;
      }
    }

    const result = execute(ctx, tool, input);
    ctx.emit({ type: "observability", span: span.end({ status: "ok" }) });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.emit({ type: "observability", span: span.end({ status: "error", error: message }) });
    return `Tool ${tool} failed: ${message}`;
  }
}

function execute(
  ctx: RunContext,
  tool: string,
  input: Record<string, unknown>,
): string {
  switch (tool) {
    case "get_room_state": {
      const s = ctx.sensors.snapshot();
      const solved = s.puzzles.filter((p) => p.solved).length;
      const lines = s.puzzles.map((p) => {
        if (p.solved) return `- ${p.name}: SOLVED`;
        const hints = p.hints.length
          ? `available hints: ${p.hints.map((h) => `"${h}"`).join("; ")}`
          : "no hints available";
        return `- ${p.name}: unsolved (${hints})`;
      });
      return `Room "${s.name}" — ${solved}/${s.puzzles.length} puzzles solved.\n${lines.join("\n")}`;
    }
    case "get_elapsed_time": {
      const s = ctx.sensors.snapshot();
      const m = Math.floor(s.elapsedMs / 60000);
      const sec = Math.floor((s.elapsedMs % 60000) / 1000);
      const total = Math.floor(s.durationMs / 60000);
      const remaining = Math.max(0, Math.floor((s.durationMs - s.elapsedMs) / 60000));
      return `${m}m ${sec}s elapsed of a ${total}m limit (~${remaining}m remaining).`;
    }
    case "ping_staff": {
      const reason = String(input.reason ?? "players requested a staff member");
      ctx.actions.pingStaff(reason);
      ctx.emit({
        type: "staff_ping",
        id: randomUUID(),
        roomId: ctx.roomId,
        kind: "human_request",
        reason,
        count: 1,
      });
      return "Staff have been notified and are on their way.";
    }
    case "skip_puzzle": {
      const ok = ctx.actions.skipPuzzle(String(input.puzzleId ?? ""));
      return ok
        ? "Puzzle marked solved (skipped), with human approval."
        : "Could not find that puzzle to skip.";
    }
    case "extend_timer": {
      const minutes = Number(input.minutes ?? 0);
      ctx.actions.extendTimer(minutes);
      return `Timer extended by ${minutes} minute(s), with human approval.`;
    }
    default:
      return `Unknown tool: ${tool}`;
  }
}
