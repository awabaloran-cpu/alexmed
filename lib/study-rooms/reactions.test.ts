import { describe, expect, it } from "vitest";
import {
  encodeReaction,
  isTap,
  parseReaction,
  REACTION_MAX_SHOWN,
  withReaction,
} from "./reactions";

const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));

describe("a reaction from another student's browser", () => {
  it("reads one of the four known words, and what this side sends", () => {
    expect(parseReaction(bytes({ k: "got" }))).toBe("got");
    expect(parseReaction(encodeReaction("bravo"))).toBe("bravo");
    // The phone app's exact bytes.
    expect(new TextDecoder().decode(encodeReaction("again"))).toBe(
      '{"k":"again"}'
    );
  });

  it("is data only: anything else is nothing", () => {
    for (const value of [
      { k: "boom" },
      { k: 1 },
      ["got"],
      "got",
      null,
      { k: "got", html: "<img onerror=alert(1)>" }.html,
    ]) {
      expect(parseReaction(bytes(value))).toBeNull();
    }
    expect(parseReaction(new TextEncoder().encode("not json"))).toBeNull();
    expect(parseReaction(new Uint8Array())).toBeNull();
    expect(parseReaction(new Uint8Array(500).fill(32))).toBeNull();
  });

  it("one per person on screen, the newest few at most", () => {
    let shown = withReaction([], { id: 1, userId: "a", kind: "got" });
    shown = withReaction(shown, { id: 2, userId: "a", kind: "again" });
    expect(shown).toEqual([{ id: 2, userId: "a", kind: "again" }]);
    for (let i = 0; i < 10; i++) {
      shown = withReaction(shown, { id: 10 + i, userId: `u${i}`, kind: "got" });
    }
    expect(shown).toHaveLength(REACTION_MAX_SHOWN);
    expect(shown.at(-1)?.userId).toBe("u9");
  });
});

describe("a tap on the file, not a drag", () => {
  const down = { x: 100, y: 100, at: 1000 };
  it("short and still is a tap", () => {
    expect(isTap(down, { x: 104, y: 103, at: 1120 })).toBe(true);
  });
  it("long, or moved, is not", () => {
    expect(isTap(down, { x: 100, y: 100, at: 1400 })).toBe(false);
    expect(isTap(down, { x: 140, y: 100, at: 1100 })).toBe(false);
  });
});
