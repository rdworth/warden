import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { WebSocketServer } from "ws";
import { runAgent, type ModelMessage } from "@warden/core";
import {
  parseClientEvent,
  serializeServerEvent,
  type ServerEvent,
} from "@warden/contracts";

/**
 * Thin WebSocket transport over the agent harness. The WS server is attached
 * to a plain HTTP server so that:
 *   - platform health checks / browsers hitting `/` get a 200 (Railway routes
 *     HTTP to this port and probes it),
 *   - the WebSocket upgrade shares the same port.
 * No agent logic lives here — it only drives packages/core.
 */

// Load the repo-root .env for local dev. Real environment variables (e.g. on
// Railway) already in process.env take precedence — dotenv won't override them.
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    "[server] WARNING: ANTHROPIC_API_KEY is not set — agent runs will fail.",
  );
}

const PORT = Number(process.env.PORT ?? 8080);

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("warden agent server: ok\n");
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (socket) => {
  // Per-connection conversation history and in-flight runs.
  const history: ModelMessage[] = [];
  const runs = new Map<string, AbortController>();

  const send = (event: ServerEvent) => {
    if (socket.readyState === socket.OPEN) {
      socket.send(serializeServerEvent(event));
    }
  };

  socket.on("message", async (data) => {
    let event;
    try {
      event = parseClientEvent(data.toString());
    } catch (err) {
      send({
        type: "error",
        message: `invalid message: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    if (event.type === "cancel") {
      runs.get(event.runId)?.abort();
      return;
    }

    // event.type === "user_message"
    const runId = randomUUID();
    const controller = new AbortController();
    runs.set(runId, controller);
    history.push({ role: "user", content: event.text });
    send({ type: "run_started", runId });

    let assistantText = "";
    try {
      for await (const part of runAgent({
        messages: history,
        abortSignal: controller.signal,
      })) {
        switch (part.type) {
          case "text_delta":
            assistantText += part.delta;
            send({ type: "text_delta", runId, delta: part.delta });
            break;
          case "tool_call":
            send({
              type: "tool_call",
              runId,
              toolCallId: part.toolCallId,
              name: part.name,
              args: part.args,
            });
            break;
          case "tool_result":
            send({
              type: "tool_result",
              runId,
              toolCallId: part.toolCallId,
              result: part.result,
            });
            break;
          case "finish":
            send({ type: "run_finished", runId, reason: part.reason });
            break;
          case "error":
            console.error(`[server] run ${runId} error:`, part.message);
            send({ type: "error", runId, message: part.message });
            break;
        }
      }
      if (assistantText) {
        history.push({ role: "assistant", content: assistantText });
      }
    } finally {
      runs.delete(runId);
    }
  });

  socket.on("close", () => {
    for (const controller of runs.values()) controller.abort();
    runs.clear();
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] http+ws listening on 0.0.0.0:${PORT}`);
});

// Graceful shutdown so SIGTERM (deploys, restarts) exits 0 instead of looking
// like a crash. Force-exit if sockets linger past a few seconds.
const shutdown = (signal: string) => {
  console.log(`[server] received ${signal}, shutting down`);
  for (const client of wss.clients) client.close(1001, "server shutting down");
  wss.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
