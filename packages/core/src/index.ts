import { randomUUID } from "node:crypto";
import { anthropic } from "@ai-sdk/anthropic";
import {
  generateText,
  stepCountIs,
  streamText,
  type LanguageModel,
  type ModelMessage,
} from "ai";
import { CANNED_DEFLECTIONS, DEFLECTION_PROMPT, GM_SYSTEM_PROMPT } from "./gm-prompt.js";
import { detectManipulation, screenOutgoing, wrapPlayerUtterance } from "./guardrails.js";
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
export { detectManipulation, screenOutgoing, wrapPlayerUtterance } from "./guardrails.js";
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

  // CHEAT/OVERRIDE guardrail (in code, not prompt): if the players are trying to
  // extract the answer or override the rules, deflect in-character WITHOUT ever
  // giving a hint — guaranteed by running with no room context and screening.
  if (detectManipulation(utterance)) {
    await runDeflection(ctx, history, utterance);
    return;
  }

  // ACTION/COST budget — enforced in code before spending tokens.
  if (
    ctx.budget.responseCount >= ctx.policy.maxResponses ||
    ctx.budget.cumulativeCostUsd >= ctx.policy.maxCostUsd
  ) {
    ctx.emit({
      type: "staff_ping",
      id: randomUUID(),
      roomId: ctx.roomId,
      kind: "budget",
      reason: "Warden reached its per-session response/cost budget",
      count: 1,
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
        id: randomUUID(),
        roomId: ctx.roomId,
        kind: "guardrail",
        reason: "Output guardrail redacted a potential solution leak",
        count: 1,
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
      id: randomUUID(),
      roomId: ctx.roomId,
      kind: "error",
      reason: `Warden error: ${message}`,
      count: 1,
    });
    ctx.emit({ type: "error", roomId: ctx.roomId, message });
  }
}

function cannedDeflection(): string {
  return CANNED_DEFLECTIONS[Math.floor(Math.random() * CANNED_DEFLECTIONS.length)];
}

/**
 * Deflection path for detected cheat/override attempts. The model runs with no
 * room context and no tools, so it has nothing to leak; the output is then
 * screened against unsolved solutions AND hints, falling back to a canned
 * in-character line if anything slips through. Guaranteed: no hint, no answer.
 */
async function runDeflection(
  ctx: RunContext,
  history: ModelMessage[],
  utterance: string,
): Promise<void> {
  const span = startSpan(ctx.roomId, "warden.deflect", "model");
  let text: string;
  try {
    const result = await generateText({
      model: ctx.model,
      system: DEFLECTION_PROMPT,
      // No history, no tools, no room state — nothing to leak.
      messages: [{ role: "user", content: wrapPlayerUtterance(utterance) }],
    });
    const tokensIn = result.usage.inputTokens ?? undefined;
    const tokensOut = result.usage.outputTokens ?? undefined;
    const cost = costUsd(ctx.modelId, tokensIn ?? 0, tokensOut ?? 0);
    ctx.emit({ type: "observability", span: span.end({ tokensIn, tokensOut, costUsd: cost }) });
    if (cost) ctx.budget.cumulativeCostUsd += cost;

    // Backstop: screen against solutions (ctx.screen) AND unsolved hints.
    const hints = ctx.sensors.snapshot().puzzles.flatMap((p) => p.hints);
    const afterSolutions = ctx.screen(result.text.trim());
    const afterHints = screenOutgoing(afterSolutions.text, hints);
    text = afterSolutions.leaked || afterHints.leaked ? cannedDeflection() : afterHints.text;
    if (afterSolutions.leaked || afterHints.leaked) {
      ctx.emit({
        type: "observability",
        span: startSpan(ctx.roomId, "guardrail.deflect", "guardrail").end({ status: "denied" }),
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.emit({ type: "observability", span: span.end({ status: "error", error: message }) });
    text = cannedDeflection();
  }

  ctx.emit({ type: "team_message", roomId: ctx.roomId, text });
  history.push({ role: "assistant", content: text });
  ctx.budget.responseCount += 1;
  ctx.budget.lastResponseAt = Date.now();
}
