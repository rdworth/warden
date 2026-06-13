import { anthropic } from "@ai-sdk/anthropic";
import { stepCountIs, streamText, tool, type ModelMessage } from "ai";
import { z } from "zod";

/**
 * The agent harness. This module knows nothing about WebSockets, HTTP, or
 * Next.js — it just turns a conversation into an async stream of harness
 * events. That keeps it unit-testable and lets you drive it from a CLI, a
 * test, or the WS server in apps/server without changes.
 */

export type { ModelMessage } from "ai";

export type HarnessEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; toolCallId: string; name: string; args: unknown }
  | { type: "tool_result"; toolCallId: string; result: unknown }
  | { type: "finish"; reason: string }
  | { type: "error"; message: string };

export interface RunAgentOptions {
  messages: ModelMessage[];
  /** Defaults to MODEL env var, then claude-opus-4-8. */
  model?: string;
  system?: string;
  /** Abort the run mid-flight (wired to the `cancel` client event). */
  abortSignal?: AbortSignal;
}

const DEFAULT_MODEL = "claude-opus-4-8";

/**
 * Example tool. Promote real actions to dedicated tools like this so the
 * harness can gate / render / audit them — see the README for guidance.
 */
const tools = {
  getCurrentTime: tool({
    description: "Get the current date and time as an ISO 8601 string.",
    inputSchema: z.object({}),
    execute: async () => new Date().toISOString(),
  }),
};

export async function* runAgent(
  opts: RunAgentOptions,
): AsyncGenerator<HarnessEvent> {
  const model = opts.model ?? process.env.MODEL ?? DEFAULT_MODEL;

  try {
    const result = streamText({
      model: anthropic(model),
      system: opts.system ?? "You are a helpful agent.",
      messages: opts.messages,
      tools,
      // Allow the model to call a tool, see the result, and keep going.
      stopWhen: stepCountIs(5),
      abortSignal: opts.abortSignal,
    });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          yield { type: "text_delta", delta: part.text };
          break;
        case "tool-call":
          yield {
            type: "tool_call",
            toolCallId: part.toolCallId,
            name: part.toolName,
            args: part.input,
          };
          break;
        case "tool-result":
          yield {
            type: "tool_result",
            toolCallId: part.toolCallId,
            result: part.output,
          };
          break;
        case "finish":
          yield { type: "finish", reason: part.finishReason };
          break;
        case "error":
          yield { type: "error", message: String(part.error) };
          break;
        default:
          // text-start/-end, reasoning, tool-input deltas, step markers, etc.
          break;
      }
    }
  } catch (err) {
    yield {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
