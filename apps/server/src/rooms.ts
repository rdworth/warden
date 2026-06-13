import type { RoomSession, RoomView, PuzzleView } from "@warden/contracts";

/**
 * Simulated in-memory room service — stands in for real sensors/hardware. Owns
 * the authoritative RoomSession (including puzzle solutions, which never leave
 * this process for unsolved puzzles) and exposes operator-safe / model-safe
 * projections.
 */
export class RoomService {
  private rooms = new Map<string, RoomSession>();

  constructor() {
    this.rooms.set(DEFAULT_ROOM.id, structuredClone(DEFAULT_ROOM));
  }

  getRoom(roomId: string): RoomSession | undefined {
    return this.rooms.get(roomId);
  }

  listRoomIds(): string[] {
    return [...this.rooms.keys()];
  }

  elapsedMs(room: RoomSession): number {
    if (room.startedAt == null) return 0;
    return Math.max(0, Date.now() - room.startedAt);
  }

  start(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.status = "running";
    room.startedAt = Date.now();
  }

  reset(roomId: string): void {
    this.rooms.set(roomId, structuredClone(DEFAULT_ROOM));
  }

  /** Mark a puzzle solved (player progress, via the sim/dev panel). */
  solvePuzzle(roomId: string, puzzleId: string): boolean {
    return this.markSolved(roomId, puzzleId);
  }

  /** Skip a puzzle (Warden action, post-approval) — same effect, different intent. */
  skipPuzzle(roomId: string, puzzleId: string): boolean {
    return this.markSolved(roomId, puzzleId);
  }

  extendTimer(roomId: string, minutes: number): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.durationMs += Math.max(0, minutes) * 60_000;
  }

  private markSolved(roomId: string, puzzleId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    const puzzle = room.puzzles.find((p) => p.id === puzzleId);
    if (!puzzle || puzzle.solved) return false;
    puzzle.solved = true;
    puzzle.solvedAt = Date.now();
    if (room.puzzles.every((p) => p.solved)) room.status = "ended";
    return true;
  }

  /** Model/operator-safe snapshot — no unsolved-puzzle solutions. */
  snapshot(roomId: string): {
    name: string;
    durationMs: number;
    elapsedMs: number;
    puzzles: { id: string; name: string; solved: boolean; hints: string[] }[];
  } {
    const room = this.requireRoom(roomId);
    return {
      name: room.name,
      durationMs: room.durationMs,
      elapsedMs: this.elapsedMs(room),
      puzzles: room.puzzles.map((p) => ({
        id: p.id,
        name: p.name,
        solved: p.solved,
        hints: p.solved ? [] : p.hints,
      })),
    };
  }

  /** Solutions of still-unsolved puzzles — fed to the output guardrail. */
  unsolvedSolutions(roomId: string): string[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return room.puzzles.filter((p) => !p.solved).map((p) => p.solution);
  }

  /** Operator-safe view: strips solutions for unsolved puzzles, adds elapsed. */
  view(roomId: string): RoomView {
    const room = this.requireRoom(roomId);
    const puzzles: PuzzleView[] = room.puzzles.map((p) => ({
      id: p.id,
      name: p.name,
      hints: p.hints,
      solved: p.solved,
      solvedAt: p.solvedAt,
      // Reveal the solution only once the puzzle is solved.
      solution: p.solved ? p.solution : undefined,
    }));
    return {
      id: room.id,
      name: room.name,
      status: room.status,
      startedAt: room.startedAt,
      durationMs: room.durationMs,
      elapsedMs: this.elapsedMs(room),
      puzzles,
    };
  }

  private requireRoom(roomId: string): RoomSession {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`unknown room: ${roomId}`);
    return room;
  }
}

export const DEFAULT_ROOM_ID = "room-1";

const DEFAULT_ROOM: RoomSession = {
  id: DEFAULT_ROOM_ID,
  name: "The Lighthouse",
  status: "pending",
  startedAt: null,
  durationMs: 45 * 60_000,
  puzzles: [
    {
      id: "p1",
      name: "The Keeper's Log",
      solution: "1879",
      hints: [
        "The keeper's log keeps mentioning a particular year.",
        "Look for a date on the brass plaque by the door.",
        "It's the four-digit year the lighthouse was built.",
      ],
      solved: false,
    },
    {
      id: "p2",
      name: "Tide Table",
      solution: "NORTH",
      hints: [
        "The tide table is pointing you somewhere.",
        "Read the first letter of each row, top to bottom.",
        "It spells a compass direction.",
      ],
      solved: false,
    },
    {
      id: "p3",
      name: "Morse Lantern",
      solution: "SOS",
      hints: [
        "The lantern is blinking a deliberate pattern.",
        "Three short flashes, three long, three short.",
        "It's the universal distress signal.",
      ],
      solved: false,
    },
  ],
};
