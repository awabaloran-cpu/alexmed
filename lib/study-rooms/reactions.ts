// 👏 Quick reactions in a room (got it / again / question / well done): sent
// between the people in the room's voice over LiveKit's data channel, on
// their own topic, never stored. The phone app sends and reads exactly the
// same bytes (mobile/lib/features/rooms/application/active_room.dart).
//
// What arrives was written by another student's browser: it is read as
// data only — one known word, or nothing.

export const REACTION_TOPIC = "reaction";
export const REACTION_KINDS = ["got", "again", "question", "bravo"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

// How long a reaction stays on screen, and how often one may be sent.
export const REACTION_LIFE_MS = 4000;
export const REACTION_GAP_MS = 1200;
// Never a wall of them.
export const REACTION_MAX_SHOWN = 4;

export function encodeReaction(kind: ReactionKind): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify({ k: kind }));
}

export function parseReaction(data: Uint8Array): ReactionKind | null {
  if (data.length === 0 || data.length > 64) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(data));
    const kind =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as { k?: unknown }).k
        : null;
    return typeof kind === "string" &&
      (REACTION_KINDS as readonly string[]).includes(kind)
      ? (kind as ReactionKind)
      : null;
  } catch {
    return null;
  }
}

export type ShownReaction = { id: number; userId: string; kind: ReactionKind };

// The reactions on screen once [incoming] arrives: one per person (their
// newest), the newest few at most.
export function withReaction(
  shown: ShownReaction[],
  incoming: ShownReaction
): ShownReaction[] {
  const next = [...shown.filter(r => r.userId !== incoming.userId), incoming];
  return next.slice(-REACTION_MAX_SHOWN);
}

// A touch that is a tap — short and still — not a drag, a pinch or a long
// press: it shows or hides a room's controls over its file.
export const TAP_MAX_MS = 250;
export const TAP_MAX_MOVE_PX = 12;
export function isTap(
  down: { x: number; y: number; at: number },
  up: { x: number; y: number; at: number }
): boolean {
  return (
    up.at - down.at < TAP_MAX_MS &&
    Math.hypot(up.x - down.x, up.y - down.y) < TAP_MAX_MOVE_PX
  );
}
