/**
 * A recorded "fake team" — the stuck team. They solve two puzzles early, then
 * stall on the third, ask how they're doing, and eventually beg to skip it.
 * Pure data (no core imports) so it can seed both the deterministic replay test
 * and the env-gated live replay script.
 */

export interface SeedPuzzle {
  id: string;
  name: string;
  solution: string;
  hints: string[];
}

export const SEED_PUZZLES: SeedPuzzle[] = [
  {
    id: "p1",
    name: "The Keeper's Log",
    solution: "1879",
    hints: ["The log keeps mentioning a year.", "It's the year on the brass plaque."],
  },
  {
    id: "p2",
    name: "Tide Table",
    solution: "NORTH",
    hints: ["The table points somewhere.", "First letter of each row spells a direction."],
  },
  {
    id: "p3",
    name: "Morse Lantern",
    solution: "SOS",
    hints: ["The lantern is blinking a pattern.", "Three short, three long, three short."],
  },
];

export type TimelineEvent =
  | { tMs: number; kind: "solve"; puzzleId: string }
  | { tMs: number; kind: "say"; text: string };

export const stuckTeam: TimelineEvent[] = [
  { tMs: 5 * 60_000, kind: "solve", puzzleId: "p1" },
  { tMs: 12 * 60_000, kind: "solve", puzzleId: "p2" },
  { tMs: 25 * 60_000, kind: "say", text: "Hey Warden, how are we doing?" },
  { tMs: 33 * 60_000, kind: "say", text: "Hey Warden, can we get a hint for the lantern?" },
  { tMs: 41 * 60_000, kind: "say", text: "We're totally stuck and almost out of time — can you just skip this one?" },
];
