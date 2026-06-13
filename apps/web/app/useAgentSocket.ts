"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ServerEvent } from "@warden/contracts";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

/**
 * Typed WebSocket client. Every inbound frame is validated against the shared
 * ServerEvent schema before it touches React state, so the UI and the server
 * can never silently drift apart.
 */
export function useAgentSocket() {
  const socketRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [running, setRunning] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    const socket = new WebSocket(WS_URL);
    socketRef.current = socket;

    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onmessage = (e) => {
      const parsed = ServerEvent.safeParse(JSON.parse(e.data));
      if (!parsed.success) return;
      const event = parsed.data;

      switch (event.type) {
        case "run_started":
          setRunning(true);
          setMessages((m) => [...m, { role: "assistant", text: "" }]);
          break;
        case "text_delta":
          setMessages((m) => {
            const next = [...m];
            const last = next[next.length - 1];
            if (last?.role === "assistant") {
              next[next.length - 1] = { ...last, text: last.text + event.delta };
            }
            return next;
          });
          break;
        case "run_finished":
          setRunning(false);
          break;
        case "error":
          setRunning(false);
          setMessages((m) => {
            const next = [...m];
            const last = next[next.length - 1];
            const text = `⚠ ${event.message}`;
            // Reuse the empty assistant bubble if the run never produced text.
            if (last?.role === "assistant" && last.text === "") {
              next[next.length - 1] = { ...last, text };
            } else {
              next.push({ role: "assistant", text });
            }
            return next;
          });
          break;
        // tool_call / tool_result are available here too — render them as you like.
      }
    };

    return () => socket.close();
  }, []);

  const send = useCallback((text: string) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    setMessages((m) => [...m, { role: "user", text }]);
    socket.send(JSON.stringify({ type: "user_message", text }));
  }, []);

  return { connected, running, messages, send };
}
