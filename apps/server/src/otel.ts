import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

/**
 * Register a real OpenTelemetry tracer provider so the spans core creates
 * (model calls, tool calls, guardrails) are genuine OTel spans. Export is
 * intentionally left unconfigured for v1 — the live operator console is fed by
 * `observability` WS events, not span export. To ship spans to a backend later,
 * add a span processor + OTLP exporter here (env-driven).
 */
let started = false;

export function initOtel(): void {
  if (started) return;
  started = true;
  const provider = new NodeTracerProvider();
  provider.register();
}
