import { anthropic } from "@ai-sdk/anthropic";
import {
  stepCountIs,
  streamText,
  type LanguageModel,
  type ModelMessage,
} from "ai";
import { GM_SYSTEM_PROMPT } from "./gm-prompt.js";
import { wrapPlayerUtterance } from "./guardrails.js";
import { costUsd, startSpan } from "./telemetry.js";
import { makeTools } from "./tools.js";
import type { RunContext } from "./types.js";

/**
 * The Game Master harness. Transport-agnostic and push-based: it drives the
 * model + gated tools for one player utterance and emits events through
 * ctx.emit (team messages, approvals, staff pings, observability spans). The
 * server backs ctx with the real room service + WS; tests back it with fakes.
 */

export * from "./types.js";
export { GM_SYSTEM_PROMPT } from "./gm-prompt.js";
export { screenOutgoing, wrapPlayerUtterance } from "./guardrails.js";
export { costUsd } from "./telemetry.js";
export { runTool } from "./policy.js";
export type { ModelMessage } from "ai";

export const DEFAULT_MODEL = "claude-opus-4-8";

/** The default production model + its id (for cost lookup). */
export function defaultModel(): { model: LanguageModel; modelId: string } {
  const modelId = process.env.MODEL ?? DEFAULT_MODEL;
  return { model: anthropic(modelId), modelId };
}

export async function runWarden(
  ctx: RunContext,
  history: ModelMessage[],
  utterance: string,
): Promise<void> {
  // INPUT guardrail: frame player speech as untrusted data.
  history.push({ role: "user", content: wrapPlayerUtterance(utterance) });

  // ACTION/COST budget — enforced in code before spending tokens.
  if (
    ctx.budget.responseCount >= ctx.policy.maxResponses ||
    ctx.budget.cumulativeCostUsd >= ctx.policy.maxCostUsd
  ) {
    ctx.emit({
      type: "staff_ping",
      roomId: ctx.roomId,
      reason: "Warden reached its per-session response/cost budget",
    });
    ctx.emit({
      type: "team_message",
      roomId: ctx.roomId,
      text: "Hang tight — I'm looping in the staff so you get the help you need.",
    });
    return;
  }

  const span = startSpan(ctx.roomId, "warden.generate", "model");
  try {
    const result = streamText({
      model: ctx.model,
      system: GM_SYSTEM_PROMPT,
      messages: history,
      tools: makeTools(ctx),
      stopWhen: stepCountIs(6),
      experimental_telemetry: { isEnabled: true, functionId: "warden-gm" },
    });

    const finalText = (await result.text).trim();
    const usage = await result.usage;
    const tokensIn = usage.inputTokens ?? undefined;
    const tokensOut = usage.outputTokens ?? undefined;
    const cost = costUsd(ctx.modelId, tokensIn ?? 0, tokensOut ?? 0);
    ctx.emit({
      type: "observability",
      span: span.end({ tokensIn, tokensOut, costUsd: cost }),
    });
    if (cost) ctx.budget.cumulativeCostUsd += cost;

    // OUTPUT guardrail: never leak an unsolved puzzle's solution.
    const screened = ctx.screen(finalText);
    if (screened.leaked) {
      const g = startSpan(ctx.roomId, "guardrail.output", "guardrail");
      ctx.emit({ type: "observability", span: g.end({ status: "denied" }) });
      ctx.emit({
        type: "staff_ping",
        roomId: ctx.roomId,
        reason: "Output guardrail redacted a potential solution leak",
      });
    }

    const text =
      screened.text || "Let me take a quick look and get right back to you.";
    ctx.emit({ type: "team_message", roomId: ctx.roomId, text });
    history.push({ role: "assistant", content: finalText });
    ctx.budget.responseCount += 1;
    ctx.budget.lastResponseAt = Date.now();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.emit({
      type: "observability",
      span: span.end({ status: "error", error: message }),
    });
    ctx.emit({
      type: "staff_ping",
      roomId: ctx.roomId,
      reason: `Warden error: ${message}`,
    });
    ctx.emit({ type: "error", roomId: ctx.roomId, message });
  }
}
