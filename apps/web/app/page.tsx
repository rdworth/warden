"use client";

import { useState } from "react";
import { useAgentSocket } from "./useAgentSocket";

export default function Home() {
  const { connected, running, messages, send } = useAgentSocket();
  const [input, setInput] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    send(text);
    setInput("");
  };

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem" }}>
      <h1 style={{ fontSize: "1.25rem" }}>
        Warden{" "}
        <span style={{ fontSize: "0.8rem", color: connected ? "green" : "#999" }}>
          {connected ? "● connected" : "○ disconnected"}
        </span>
      </h1>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
          margin: "1.5rem 0",
        }}
      >
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "80%",
              padding: "0.5rem 0.75rem",
              borderRadius: 12,
              background: m.role === "user" ? "#1a1a1a" : "#f0f0f0",
              color: m.role === "user" ? "white" : "black",
              whiteSpace: "pre-wrap",
            }}
          >
            {m.text || (m.role === "assistant" && running ? "…" : "")}
          </div>
        ))}
      </div>

      <form onSubmit={submit} style={{ display: "flex", gap: "0.5rem" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the agent…"
          style={{
            flex: 1,
            padding: "0.6rem 0.75rem",
            borderRadius: 8,
            border: "1px solid #ccc",
          }}
        />
        <button
          type="submit"
          disabled={!connected}
          style={{
            padding: "0.6rem 1rem",
            borderRadius: 8,
            border: "none",
            background: "#1a1a1a",
            color: "white",
            cursor: "pointer",
          }}
        >
          Send
        </button>
      </form>
    </main>
  );
}
