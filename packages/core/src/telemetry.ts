import { randomUUID } from "node:crypto";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { SpanRecord } from "@warden/contracts";

/**
 * Real OpenTelemetry spans (captured by the provider the server registers) plus
 * a SpanRecord projection for the live operator console. Cost is derived from
 * token usage via a per-model pricing map.
 */

const PRICING: Record<string, { in: number; out: number }> = {
  // USD per million tokens.
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-opus-4-7": { in: 5, out: 25 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};

export function costUsd(
  modelId: string,
  tokensIn = 0,
  tokensOut = 0,
): number | undefined {
  const p = PRICING[modelId];
  if (!p) return undefined;
  return (tokensIn * p.in + tokensOut * p.out) / 1_000_000;
}

const tracer = trace.getTracer("warden");

export interface SpanEndOpts {
  status?: SpanRecord["status"];
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  error?: string;
}

export interface SpanHandle {
  end(opts?: SpanEndOpts): SpanRecord;
}

export function startSpan(
  roomId: string,
  name: string,
  kind: SpanRecord["kind"],
): SpanHandle {
  const span = tracer.startSpan(name);
  span.setAttribute("warden.room_id", roomId);
  span.setAttribute("warden.kind", kind);
  const start = performance.now();

  return {
    end(opts: SpanEndOpts = {}): SpanRecord {
      const durationMs = Math.round(performance.now() - start);
      const status = opts.status ?? (opts.error ? "error" : "ok");
      if (opts.tokensIn != null) span.setAttribute("warden.tokens_in", opts.tokensIn);
      if (opts.tokensOut != null) span.setAttribute("warden.tokens_out", opts.tokensOut);
      if (opts.costUsd != null) span.setAttribute("warden.cost_usd", opts.costUsd);
      if (opts.error) span.recordException(opts.error);
      if (status !== "ok") {
        span.setStatus({ code: SpanStatusCode.ERROR, message: opts.error });
      }
      span.end();
      return {
        id: randomUUID(),
        roomId,
        name,
        kind,
        durationMs,
        status,
        tokensIn: opts.tokensIn,
        tokensOut: opts.tokensOut,
        costUsd: opts.costUsd,
        error: opts.error,
      };
    },
  };
}
