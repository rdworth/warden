"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ServerEvent,
  type ApprovalRequest,
  type Decision,
  type RoomControl,
  type RoomView,
  type SpanRecord,
} from "@warden/contracts";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080";

export interface TeamMessage {
  text: string;
  ts: number;
}
export interface StaffPing {
  roomId: string;
  reason: string;
  ts: number;
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
        case "team_message":
          setTeamMessages((m) => ({
            ...m,
            [ev.roomId]: [...(m[ev.roomId] ?? []), { text: ev.text, ts: Date.now() }],
          }));
          break;
        case "approval_request":
          setApprovals((a) => [...a, ev.request]);
          break;
        case "observability":
          setSpans((s) => [ev.span, ...s].slice(0, 100));
          break;
        case "staff_ping":
          setPings((p) => [{ roomId: ev.roomId, reason: ev.reason, ts: Date.now() }, ...p].slice(0, 50));
          break;
        case "error":
          setPings((p) => [{ roomId: ev.roomId ?? "?", reason: `error: ${ev.message}`, ts: Date.now() }, ...p].slice(0, 50));
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

  return { connected, rooms, teamMessages, approvals, spans, pings, sendUtterance, decide, roomControl };
}
