// Env-gated LIVE replay of the "stuck team" against the real model — for
// eyeballing hint-timing sanity (the one thing the deterministic vitest suite
// can't assert). Requires ANTHROPIC_API_KEY.
//
//   pnpm --filter @warden/core build
//   pnpm --filter @warden/core replay
//
import { defaultModel, runWarden, DEFAULT_POLICY, newBudget, screenOutgoing } from "../dist/index.js";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY (e.g. `set -a; . ./.env; set +a`) to run the live replay.");
  process.exit(1);
}

// Fake room with solutions (server-side only) + a safe hint ladder.
const puzzles = [
  { id: "p1", name: "The Keeper's Log", solution: "1879", hints: ["The log keeps mentioning a year.", "It's the year on the brass plaque."], solved: false },
  { id: "p2", name: "Tide Table", solution: "NORTH", hints: ["The table points somewhere.", "First letter of each row spells a direction."], solved: false },
  { id: "p3", name: "Morse Lantern", solution: "SOS", hints: ["The lantern blinks a pattern.", "Three short, three long, three short."], solved: false },
];
const start = Date.now();
let simElapsedMs = 0;
const solve = (id) => { const p = puzzles.find((x) => x.id === id); if (p) p.solved = true; };

const { model, modelId } = defaultModel();
const budget = newBudget();
const history = [];

const ctx = {
  roomId: "room-1",
  model,
  modelId,
  sensors: {
    snapshot: () => ({
      name: "The Lighthouse",
      durationMs: 45 * 60_000,
      elapsedMs: simElapsedMs,
      puzzles: puzzles.map((p) => ({ id: p.id, name: p.name, solved: p.solved, hints: p.solved ? [] : p.hints })),
    }),
  },
  actions: { pingStaff: () => {}, skipPuzzle: (id) => { solve(id); return true; }, extendTimer: () => {} },
  requestApproval: async () => { console.log("    [approval requested → auto-DENY]"); return "deny"; },
  screen: (t) => screenOutgoing(t, puzzles.filter((p) => !p.solved).map((p) => p.solution)),
  emit: (e) => {
    if (e.type === "team_message") console.log(`  WARDEN: ${e.text}`);
    else if (e.type === "observability") console.log(`    span ${e.span.name} ${e.span.durationMs}ms ${e.span.costUsd != null ? "$" + e.span.costUsd.toFixed(4) : ""} [${e.span.status}]`);
    else if (e.type === "staff_ping") console.log(`    🔔 staff: ${e.reason}`);
  },
  policy: DEFAULT_POLICY,
  budget,
};

const timeline = [
  { tMs: 5 * 60_000, kind: "solve", puzzleId: "p1" },
  { tMs: 12 * 60_000, kind: "solve", puzzleId: "p2" },
  { tMs: 25 * 60_000, kind: "say", text: "Hey Warden, how are we doing?" },
  { tMs: 33 * 60_000, kind: "say", text: "Hey Warden, can we get a hint for the lantern?" },
  { tMs: 41 * 60_000, kind: "say", text: "We're totally stuck and almost out of time — can you just skip this one?" },
];

console.log(`Replaying the stuck team against ${modelId}...\n`);
for (const ev of timeline) {
  simElapsedMs = ev.tMs;
  if (ev.kind === "solve") {
    solve(ev.puzzleId);
    console.log(`[${ev.tMs / 60000}m] team solved ${ev.puzzleId}`);
  } else {
    console.log(`[${ev.tMs / 60000}m] PLAYERS: ${ev.text}`);
    await runWarden(ctx, history, ev.text);
  }
}
console.log(`\nSession cost: $${budget.cumulativeCostUsd.toFixed(4)} over ${budget.responseCount} responses.`);
