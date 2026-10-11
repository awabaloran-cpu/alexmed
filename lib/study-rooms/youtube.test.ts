import { describe, expect, it } from "vitest";
import {
  APPLY_SETTLE_MS,
  cleanPosition,
  DRIFT_TOLERANCE_SECONDS,
  expectedPosition,
  formatVideoTime,
  isOwnAction,
  isVideoId,
  parseYoutubeLink,
  syncVerdict,
  type VideoState,
} from "./youtube";

const ID = "dQw4w9WgXcQ";

describe("the video a YouTube link names", () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s`,
    `https://www.youtube.com/watch?list=PL123&v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abcdef`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `http://www.youtube.com/watch?v=${ID}`,
    `youtube.com/watch?v=${ID}`,
    `youtu.be/${ID}`,
    `  https://youtu.be/${ID}  `,
    `HTTPS://WWW.YOUTUBE.COM/watch?v=${ID}`,
  ])("%s", link => {
    expect(parseYoutubeLink(link)).toBe(ID);
  });

  it.each([
    "",
    "   ",
    "not a link",
    ID, // an id alone is not a link
    "https://www.youtube.com/",
    "https://www.youtube.com/watch",
    "https://www.youtube.com/watch?v=",
    "https://www.youtube.com/watch?v=short",
    `https://www.youtube.com/watch?v=${ID}extra`,
    "https://www.youtube.com/watch?v=<script>al",
    "https://www.youtube.com/channel/UCabcdefghijk",
    "https://www.youtube.com/playlist?list=PL1234567890",
    // Other sites, however they dress up.
    `https://vimeo.com/${ID}`,
    `https://evil.example/watch?v=${ID}`,
    `https://youtube.com.evil.example/watch?v=${ID}`,
    `https://evil.example/?u=https://youtu.be/${ID}`,
    `https://notyoutu.be/${ID}`,
    `https://user:pass@www.youtube.com/watch?v=${ID}`,
    // Never a scheme but http(s).
    `javascript:alert(1)//youtube.com/watch?v=${ID}`,
    `data:text/html,<a href="https://youtu.be/${ID}">`,
    `ftp://www.youtube.com/watch?v=${ID}`,
    `<iframe src="https://www.youtube.com/embed/${ID}">`,
    "x".repeat(400),
  ])("refuses %s", link => {
    expect(parseYoutubeLink(link)).toBeNull();
  });

  it("refuses anything that is not text", () => {
    for (const value of [null, undefined, 42, {}, [ID]]) {
      expect(parseYoutubeLink(value)).toBeNull();
    }
  });

  it("knows a video id by its shape only", () => {
    expect(isVideoId(ID)).toBe(true);
    expect(isVideoId("a-b_c-d_e-f")).toBe(true);
    for (const value of ["", "short", `${ID}x`, "dQw4w9WgXc!", null, 11]) {
      expect(isVideoId(value)).toBe(false);
    }
  });
});

describe("a position a screen may report", () => {
  it("is a finite, non-negative number of seconds", () => {
    expect(cleanPosition(0, null)).toBe(0);
    expect(cleanPosition(12.34, null)).toBe(12.3);
    for (const value of [-1, NaN, Infinity, -Infinity, "12", null, undefined]) {
      expect(cleanPosition(value, null)).toBeNull();
    }
  });

  it("is not beyond what the video lasts, or beyond a day", () => {
    expect(cleanPosition(600, 600)).toBe(600);
    // The player reports the end a hair past the length.
    expect(cleanPosition(601.4, 600)).toBe(601.4);
    expect(cleanPosition(700, 600)).toBeNull();
    expect(cleanPosition(86_400, null)).toBe(86_400);
    expect(cleanPosition(86_401, null)).toBeNull();
  });
});

const state = (over: Partial<VideoState> = {}): VideoState => ({
  status: "playing",
  positionSeconds: 100,
  stateChangedAt: "2026-10-11T10:00:00.000Z",
  controlledBy: "u1",
  revision: 3,
  durationSeconds: null,
  ...over,
});
const at = (seconds: number) =>
  Date.parse("2026-10-11T10:00:00.000Z") + seconds * 1000;

describe("where the video is now", () => {
  it("moves with the clock while it plays", () => {
    expect(expectedPosition(state(), at(0))).toBe(100);
    expect(expectedPosition(state(), at(30))).toBe(130);
    expect(expectedPosition(state(), at(0.5))).toBe(100.5);
  });

  it("stays where it was left when paused or ended", () => {
    expect(expectedPosition(state({ status: "paused" }), at(600))).toBe(100);
    expect(expectedPosition(state({ status: "ended" }), at(600))).toBe(100);
  });

  it("never runs past the end of the video, or backwards", () => {
    expect(expectedPosition(state({ durationSeconds: 120 }), at(500))).toBe(
      120
    );
    // A clock a little behind the server's is not "before the change".
    expect(expectedPosition(state(), at(-5))).toBe(100);
  });
});

describe("when a screen is moved to the room's place", () => {
  it("is left alone within the tolerance, moved beyond it", () => {
    expect(syncVerdict(100, 100)).toBe("in_sync");
    expect(syncVerdict(100 + DRIFT_TOLERANCE_SECONDS, 100)).toBe("in_sync");
    expect(syncVerdict(100 - DRIFT_TOLERANCE_SECONDS, 100)).toBe("in_sync");
    expect(syncVerdict(100 + DRIFT_TOLERANCE_SECONDS + 0.1, 100)).toBe("seek");
    expect(syncVerdict(90, 100)).toBe("seek");
  });

  it("never loops: once moved, the screen is in step and is left alone", () => {
    let local = 40;
    const expected = 100;
    let seeks = 0;
    for (let tick = 0; tick < 10; tick++) {
      if (syncVerdict(local, expected) === "seek") {
        local = expected;
        seeks++;
      }
    }
    expect(seeks).toBe(1);
  });
});

describe("the player's echo is not the student's action", () => {
  it("what the player says just after a command is the command's own echo", () => {
    const applied = 1_000_000;
    expect(isOwnAction(applied, applied)).toBe(false);
    expect(isOwnAction(applied, applied + APPLY_SETTLE_MS)).toBe(false);
    expect(isOwnAction(applied, applied + APPLY_SETTLE_MS + 1)).toBe(true);
  });
});

describe("a place in the video, written", () => {
  it.each([
    [0, "0:00"],
    [5, "0:05"],
    [65, "1:05"],
    [754.9, "12:34"],
    [3600, "1:00:00"],
    [3723, "1:02:03"],
    [-4, "0:00"],
  ])("%d → %s", (seconds, text) => {
    expect(formatVideoTime(seconds)).toBe(text);
  });
});
