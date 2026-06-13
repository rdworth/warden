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
  type PolicyConfig,
  type RunContext,
  type SessionBudget,
} from "@warden/core";
import {
  parseClientEvent,
  serializeServerEvent,
  type Decision,
  type ServerEvent,
  type StaffPingKind,
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

// Per-session budget limits — defaults are env-overridable; operators can also
// top them up live.
function initialPolicy(): PolicyConfig {
  return {
    ...DEFAULT_POLICY,
    maxResponses: Number(process.env.WARDEN_MAX_RESPONSES ?? DEFAULT_POLICY.maxResponses),
    maxCostUsd: Number(process.env.WARDEN_MAX_COST_USD ?? DEFAULT_POLICY.maxCostUsd),
  };
}

// Per-room conversation history + budget + policy (shared across all sockets).
interface RoomRuntime {
  history: ModelMessage[];
  budget: SessionBudget;
  policy: PolicyConfig;
}
const runtimes = new Map<string, RoomRuntime>();
function runtimeFor(roomId: string): RoomRuntime {
  let rt = runtimes.get(roomId);
  if (!rt) {
    rt = { history: [], budget: newBudget(), policy: initialPolicy() };
    runtimes.set(roomId, rt);
  }
  return rt;
}

function pushBudget(roomId: string): void {
  const rt = runtimeFor(roomId);
  broadcast({
    type: "budget",
    roomId,
    responsesUsed: rt.budget.responseCount,
    responsesLimit: rt.policy.maxResponses,
    costUsd: rt.budget.cumulativeCostUsd,
    costLimit: rt.policy.maxCostUsd,
  });
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

// Open (unacknowledged) staff pings, deduplicated per (room, kind): repeated
// pings of the same kind bump a count instead of stacking up or being dropped.
interface OpenPing {
  id: string;
  roomId: string;
  kind: StaffPingKind;
  reason: string;
  count: number;
}
const openPings = new Map<string, OpenPing>();
const pingKey = (roomId: string, kind: StaffPingKind) => `${roomId}|${kind}`;

// Core emits everything through this. staff_ping is deduplicated; the rest is
// broadcast as-is.
function emitForRoom(event: ServerEvent): void {
  if (event.type !== "staff_ping") {
    broadcast(event);
    return;
  }
  const key = pingKey(event.roomId, event.kind);
  let ping = openPings.get(key);
  if (ping) {
    ping.count += 1;
    ping.reason = event.reason; // keep the latest (often-escalated) wording
  } else {
    ping = { id: event.id, roomId: event.roomId, kind: event.kind, reason: event.reason, count: 1 };
    openPings.set(key, ping);
  }
  broadcast({ ...ping, type: "staff_ping" });
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
    const rt = runtimeFor(roomId);
    socket.send(
      serializeServerEvent({
        type: "budget",
        roomId,
        responsesUsed: rt.budget.responseCount,
        responsesLimit: rt.policy.maxResponses,
        costUsd: rt.budget.cumulativeCostUsd,
        costLimit: rt.policy.maxCostUsd,
      }),
    );
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
        else if (c.action === "fast_forward") rooms.fastForward(event.roomId, c.minutes);
        else if (c.action === "reset") {
          rooms.reset(event.roomId);
          runtimes.delete(event.roomId);
          for (const [key, ping] of openPings) {
            if (ping.roomId === event.roomId) openPings.delete(key);
          }
        }
        pushRoomState(event.roomId);
        pushBudget(event.roomId);
        return;
      }

      case "budget_topup": {
        const rt = runtimeFor(event.roomId);
        if (event.responses) rt.policy.maxResponses += event.responses;
        if (event.costUsd) rt.policy.maxCostUsd += event.costUsd;
        pushBudget(event.roomId);
        return;
      }

      case "staff_respond": {
        // "acknowledged" = on the way (ping stays open); "resolved" = handled
        // (ping closes). Find the open ping; only delete it when resolved.
        let target: OpenPing | undefined;
        for (const [key, ping] of openPings) {
          if (ping.id === event.pingId) {
            target = ping;
            if (event.response === "resolved") openPings.delete(key);
            break;
          }
        }
        // Feed the staff response back into Warden's context so it reflects
        // reality instead of escalating "they asked repeatedly".
        if (target?.kind === "human_request") {
          const note =
            event.response === "acknowledged"
              ? "[STAFF UPDATE — not a player message] A human staff member has seen the players' request to speak with a person and is on their way to the room. Reassure them that help is coming; you do not need to ping staff again about this request."
              : "[STAFF UPDATE — not a player message] A human staff member has gone to the room, spoken with the players, and resolved their request to speak with a person. That request is now fully closed. If the players ask to speak with a human again, treat it as a brand-new request (page staff again) — do NOT say someone is already on their way.";
          runtimeFor(target.roomId).history.push({ role: "user", content: note });
        }
        broadcast({ type: "staff_update", pingId: event.pingId, response: event.response });
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

  // Echo the room transcript to every console before Warden responds.
  broadcast({ type: "player_message", roomId, text });

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
    emit: emitForRoom,
    policy: rt.policy,
    budget: rt.budget,
  };

  await runWarden(ctx, rt.history, text);
  // Tools (skip_puzzle / extend_timer) may have changed room state.
  pushRoomState(roomId);
  pushBudget(roomId);
}

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] http+ws (game master) listening on 0.0.0.0:${PORT}`);
});

// End rooms whose clock has run out and push the frozen state to consoles.
setInterval(() => {
  for (const roomId of rooms.tick()) pushRoomState(roomId);
}, 1000).unref();

const shutdown = (signal: string) => {
  console.log(`[server] received ${signal}, shutting down`);
  for (const client of wss.clients) client.close(1001, "server shutting down");
  wss.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
