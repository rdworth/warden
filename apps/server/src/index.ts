import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { WebSocketServer, type WebSocket } from "ws";
import {
  DEFAULT_POLICY,
  defaultModel,
  newBudget,
  runWarden,
  screenOutgoing,
  type ModelMessage,
  type RunContext,
  type SessionBudget,
} from "@warden/core";
import {
  parseClientEvent,
  serializeServerEvent,
  type Decision,
  type ServerEvent,
} from "@warden/contracts";
import { initOtel } from "./otel.js";
import { RoomService } from "./rooms.js";

/**
 * WS transport + orchestration for the escape-room Game Master. Routes operator
 * console / dev-control events, runs the GM harness per player utterance,
 * round-trips risky-action approvals back to the operator, and broadcasts team
 * messages, staff pings, observability spans, and room state to all consoles.
 * The HTTP endpoint (`GET /`) doubles as the platform health check.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("[server] WARNING: ANTHROPIC_API_KEY is not set — Warden runs will fail.");
}

initOtel();

const PORT = Number(process.env.PORT ?? 8080);
const rooms = new RoomService();

// Per-room conversation history + budget (shared across all operator sockets).
interface RoomRuntime {
  history: ModelMessage[];
  budget: SessionBudget;
}
const runtimes = new Map<string, RoomRuntime>();
function runtimeFor(roomId: string): RoomRuntime {
  let rt = runtimes.get(roomId);
  if (!rt) {
    rt = { history: [], budget: newBudget() };
    runtimes.set(roomId, rt);
  }
  return rt;
}

// Risky-action approvals awaiting a human decision, keyed by approvalId.
const pendingApprovals = new Map<string, (decision: Decision) => void>();
const APPROVAL_TIMEOUT_MS = 2 * 60_000;

const clients = new Set<WebSocket>();
function broadcast(event: ServerEvent): void {
  const payload = serializeServerEvent(event);
  for (const socket of clients) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

function pushRoomState(roomId: string): void {
  broadcast({ type: "room_state", room: rooms.view(roomId) });
}

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("warden game master: ok\n");
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (socket) => {
  clients.add(socket);
  // Bring the new console up to date.
  for (const roomId of rooms.listRoomIds()) {
    socket.send(serializeServerEvent({ type: "room_state", room: rooms.view(roomId) }));
  }

  socket.on("message", async (data) => {
    let event;
    try {
      event = parseClientEvent(data.toString());
    } catch (err) {
      socket.send(
        serializeServerEvent({
          type: "error",
          message: `invalid message: ${err instanceof Error ? err.message : String(err)}`,
        }),
      );
      return;
    }

    switch (event.type) {
      case "operator_decision": {
        const resolve = pendingApprovals.get(event.approvalId);
        if (resolve) {
          pendingApprovals.delete(event.approvalId);
          resolve(event.decision);
        }
        return;
      }

      case "room_control": {
        const c = event.control;
        if (c.action === "start") rooms.start(event.roomId);
        else if (c.action === "solve_puzzle") rooms.solvePuzzle(event.roomId, c.puzzleId);
        else if (c.action === "reset") {
          rooms.reset(event.roomId);
          runtimes.delete(event.roomId);
        }
        pushRoomState(event.roomId);
        return;
      }

      case "player_utterance": {
        await handleUtterance(event.roomId, event.text);
        return;
      }

      case "cancel":
        // No per-run cancellation in v1.
        return;
    }
  });

  socket.on("close", () => {
    clients.delete(socket);
  });
});

async function handleUtterance(roomId: string, text: string): Promise<void> {
  const room = rooms.getRoom(roomId);
  if (!room) {
    broadcast({ type: "error", roomId, message: `unknown room: ${roomId}` });
    return;
  }

  const rt = runtimeFor(roomId);
  const { model, modelId } = defaultModel();

  const ctx: RunContext = {
    roomId,
    model,
    modelId,
    sensors: { snapshot: () => rooms.snapshot(roomId) },
    actions: {
      pingStaff: (reason) => console.log(`[staff] room ${roomId}: ${reason}`),
      skipPuzzle: (puzzleId) => rooms.skipPuzzle(roomId, puzzleId),
      extendTimer: (minutes) => rooms.extendTimer(roomId, minutes),
    },
    requestApproval: (ask) =>
      new Promise<Decision>((resolveDecision) => {
        const approvalId = randomUUID();
        const timer = setTimeout(() => {
          if (pendingApprovals.delete(approvalId)) resolveDecision("deny");
        }, APPROVAL_TIMEOUT_MS);
        pendingApprovals.set(approvalId, (decision) => {
          clearTimeout(timer);
          resolveDecision(decision);
        });
        broadcast({
          type: "approval_request",
          request: { approvalId, roomId, tool: ask.tool, input: ask.input, reason: ask.reason },
        });
      }),
    screen: (out) => screenOutgoing(out, rooms.unsolvedSolutions(roomId)),
    emit: broadcast,
    policy: DEFAULT_POLICY,
    budget: rt.budget,
  };

  await runWarden(ctx, rt.history, text);
  // Tools (skip_puzzle / extend_timer) may have changed room state.
  pushRoomState(roomId);
}

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] http+ws (game master) listening on 0.0.0.0:${PORT}`);
});

const shutdown = (signal: string) => {
  console.log(`[server] received ${signal}, shutting down`);
  for (const client of wss.clients) client.close(1001, "server shutting down");
  wss.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
