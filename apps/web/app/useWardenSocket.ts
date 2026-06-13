"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ServerEvent,
  type ApprovalRequest,
  type Decision,
  type RoomControl,
  type RoomView,
  type SpanRecord,
  type StaffResponse,
} from "@warden/contracts";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080";

export interface TeamMessage {
  role: "player" | "warden";
  text: string;
  ts: number;
}
export type StaffPingStatus = "pending" | "acknowledged" | "resolved";
export interface StaffPing {
  id: string;
  roomId: string;
  reason: string;
  count: number;
  ts: number;
  status: StaffPingStatus;
}
export interface BudgetView {
  responsesUsed: number;
  responsesLimit: number;
  costUsd: number;
  costLimit: number;
}

/**
 * Typed operator-console client. Every inbound frame is validated against the
 * shared ServerEvent schema before it touches React state, so the console and
 * the server can never silently drift.
 */
export function useWardenSocket() {
  const socketRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [rooms, setRooms] = useState<Record<string, RoomView>>({});
  const [teamMessages, setTeamMessages] = useState<Record<string, TeamMessage[]>>({});
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [spans, setSpans] = useState<SpanRecord[]>([]);
  const [pings, setPings] = useState<StaffPing[]>([]);
  const [budgets, setBudgets] = useState<Record<string, BudgetView>>({});

  useEffect(() => {
    const socket = new WebSocket(WS_URL);
    socketRef.current = socket;
    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onmessage = (e) => {
      const parsed = ServerEvent.safeParse(JSON.parse(e.data));
      if (!parsed.success) return;
      const ev = parsed.data;
      switch (ev.type) {
        case "room_state":
          setRooms((r) => ({ ...r, [ev.room.id]: ev.room }));
          break;
        case "budget":
          setBudgets((b) => ({
            ...b,
            [ev.roomId]: {
              responsesUsed: ev.responsesUsed,
              responsesLimit: ev.responsesLimit,
              costUsd: ev.costUsd,
              costLimit: ev.costLimit,
            },
          }));
          break;
        case "player_message":
          setTeamMessages((m) => ({
            ...m,
            [ev.roomId]: [...(m[ev.roomId] ?? []), { role: "player", text: ev.text, ts: Date.now() }],
          }));
          break;
        case "team_message":
          setTeamMessages((m) => ({
            ...m,
            [ev.roomId]: [...(m[ev.roomId] ?? []), { role: "warden", text: ev.text, ts: Date.now() }],
          }));
          break;
        case "approval_request":
          setApprovals((a) => [...a, ev.request]);
          break;
        case "observability":
          setSpans((s) => [ev.span, ...s].slice(0, 100));
          break;
        case "staff_ping":
          setPings((p) => {
            const i = p.findIndex((x) => x.id === ev.id);
            if (i >= 0) {
              const next = [...p];
              // Preserve status (e.g. en route) on a count bump.
              next[i] = { ...next[i], reason: ev.reason, count: ev.count };
              return next;
            }
            return [
              { id: ev.id, roomId: ev.roomId, reason: ev.reason, count: ev.count, ts: Date.now(), status: "pending" as const },
              ...p,
            ].slice(0, 50);
          });
          break;
        case "staff_update":
          setPings((p) =>
            p.map((x) => (x.id === ev.pingId ? { ...x, status: ev.response } : x)),
          );
          break;
        case "error":
          setPings((p) => [{ id: `err-${Date.now()}`, roomId: ev.roomId ?? "?", reason: `error: ${ev.message}`, count: 1, ts: Date.now(), status: "pending" as const }, ...p].slice(0, 50));
          break;
      }
    };
    return () => socket.close();
  }, []);

  const send = useCallback((msg: unknown) => {
    const s = socketRef.current;
    if (s && s.readyState === WebSocket.OPEN) s.send(JSON.stringify(msg));
  }, []);

  const sendUtterance = useCallback(
    (roomId: string, text: string) => send({ type: "player_utterance", roomId, text }),
    [send],
  );
  const decide = useCallback(
    (approvalId: string, decision: Decision) => {
      send({ type: "operator_decision", approvalId, decision });
      setApprovals((a) => a.filter((x) => x.approvalId !== approvalId));
    },
    [send],
  );
  const roomControl = useCallback(
    (roomId: string, control: RoomControl) => send({ type: "room_control", roomId, control }),
    [send],
  );
  const topUpBudget = useCallback(
    (roomId: string, amount: { responses?: number; costUsd?: number }) =>
      send({ type: "budget_topup", roomId, ...amount }),
    [send],
  );
  const respondToPing = useCallback(
    (pingId: string, response: StaffResponse) => send({ type: "staff_respond", pingId, response }),
    [send],
  );

  return {
    connected,
    rooms,
    teamMessages,
    approvals,
    spans,
    pings,
    budgets,
    sendUtterance,
    decide,
    roomControl,
    topUpBudget,
    respondToPing,
  };
}
