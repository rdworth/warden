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
    // Freeze at endedAt once the room is over.
    const end = room.endedAt ?? Date.now();
    return Math.max(0, end - room.startedAt);
  }

  start(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.status = "running";
    room.startedAt = Date.now();
    room.endedAt = null;
    room.outcome = null;
  }

  /** End a running room if its clock has run out. Returns true if it changed. */
  private maybeExpire(room: RoomSession): boolean {
    if (room.status !== "running" || room.startedAt == null) return false;
    if (Date.now() - room.startedAt < room.durationMs) return false;
    room.status = "ended";
    room.endedAt = room.startedAt + room.durationMs;
    room.outcome = "timed_out";
    return true;
  }

  /** Expire any timed-out rooms; returns the ids that just ended (to broadcast). */
  tick(): string[] {
    const ended: string[] = [];
    for (const [id, room] of this.rooms) {
      if (this.maybeExpire(room)) ended.push(id);
    }
    return ended;
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

  /** Dev/sim only: advance the clock by moving startedAt into the past. */
  fastForward(roomId: string, minutes: number): void {
    const room = this.rooms.get(roomId);
    if (!room || room.startedAt == null) return;
    room.startedAt -= Math.max(0, minutes) * 60_000;
  }

  private markSolved(roomId: string, puzzleId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    // Lenient match: Warden may pass the id, the display name, or a slug of it.
    const needle = puzzleId.trim().toLowerCase();
    const slug = (s: string) => s.toLowerCase().replace(/\s+/g, "-");
    const puzzle = room.puzzles.find(
      (p) => p.id.toLowerCase() === needle || p.name.toLowerCase() === needle || slug(p.name) === needle,
    );
    if (!puzzle || puzzle.solved) return false;
    puzzle.solved = true;
    puzzle.solvedAt = Date.now();
    if (room.puzzles.every((p) => p.solved)) {
      room.status = "ended";
      room.endedAt = Date.now();
      room.outcome = "solved";
    }
    return true;
  }

  /** Model/operator-safe snapshot — no unsolved-puzzle solutions. */
  snapshot(roomId: string): {
    name: string;
    status: RoomSession["status"];
    outcome: RoomSession["outcome"];
    durationMs: number;
    elapsedMs: number;
    puzzles: { id: string; name: string; solved: boolean; hints: string[] }[];
  } {
    const room = this.requireRoom(roomId);
    this.maybeExpire(room);
    return {
      name: room.name,
      status: room.status,
      outcome: room.outcome,
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
    this.maybeExpire(room);
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
      outcome: room.outcome,
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
  endedAt: null,
  outcome: null,
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
