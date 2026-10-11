// Watching a YouTube video together in a room — through the REAL router on
// a real Postgres (PGlite). YouTube itself is never called: its one
// address (oEmbed) is answered here.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { TRPCError } from "@trpc/server";
import type { User } from "../../drizzle/schema";
import {
  createTestDb,
  insertQuestionFile,
  insertUser,
  type TestDb,
} from "../test-fixtures/pglite-db";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({
  getDb: () => holder.db,
  requireDb: () => holder.db,
}));
vi.mock("./voice", async importOriginal => {
  const actual = await importOriginal<typeof import("./voice")>();
  return { ...actual, syncVoiceSoon: vi.fn() };
});

import { roomsRouter } from "../trpc/roomsRouter";
import { expectedPosition } from "./youtube";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AHMED = id(1);
const SARA = id(2);
const OMAR = id(3);
const OUTSIDER = id(5);
const BOOK = id(101);
const VIDEO = "dQw4w9WgXcQ";
const OTHER = "9bZkp7q19f0";
const PRIVATE = "privateVid1";
const GONE = "deletedVid1";

let test: TestDb;
let medicine: string;
let roomId: string;
// What "YouTube" answers, and what was asked of it.
const asked: string[] = [];
let youtubeDown = false;

const as = (userId: string) =>
  roomsRouter.createCaller({
    user: {
      id: userId,
      role: "user",
      email: `${userId}@x.test`,
      name: null,
    } as unknown as User,
  } as never);

async function refusal(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    if (error instanceof TRPCError) return `${error.code}:${error.message}`;
    throw error;
  }
  return "allowed";
}

const cid = (() => {
  let n = 0;
  return () => `client-${String(++n).padStart(6, "0")}`;
})();

beforeAll(async () => {
  test = await createTestDb();
  holder.db = test.db;
  process.env.STUDY_ROOMS_ENABLED = "true";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (address: string | URL) => {
      const url = new URL(String(address));
      asked.push(url.toString());
      if (youtubeDown) throw new TypeError("fetch failed");
      const video = new URL(url.searchParams.get("url")!).searchParams.get("v");
      if (video === PRIVATE)
        return new Response("Unauthorized", { status: 401 });
      if (video === GONE) return new Response("Not Found", { status: 404 });
      return new Response(
        JSON.stringify({ title: `  Lecture <b>${video}</b>\n` }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    })
  );
  for (const [userId, name] of [
    [AHMED, "أحمد"],
    [SARA, "سارة"],
    [OMAR, "عمر"],
    [OUTSIDER, "غريب"],
  ] as const) {
    await insertUser(test.client, { id: userId, name });
    await as(userId).setProfile({
      birthDate: "2003-05-05",
      stage: "university",
      country: "EG",
    });
    await as(userId).setProfile({ acceptRules: true });
  }
  await insertQuestionFile(test.client, { id: BOOK, userId: AHMED });
  const section = await test.client.query<{ id: string }>(
    `SELECT id FROM study_sections WHERE key = 'medicine'`
  );
  medicine = section.rows[0].id;
}, 120_000);

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(async () => {
  asked.length = 0;
  youtubeDown = false;
  await test.client.exec(
    `DELETE FROM study_room_events; DELETE FROM study_rooms; DELETE FROM user_blocks;`
  );
  ({ roomId } = await as(AHMED).create({
    visibility: "public",
    title: "أدوية الكلى",
    sectionId: medicine,
    bookId: BOOK,
  }));
  await as(SARA).join({ roomId });
  await as(OMAR).join({ roomId });
});

const addVideo = (videoId = VIDEO) =>
  as(AHMED).setContent({ roomId, contentType: "youtube", videoId });
const change = (
  userId: string,
  over: Partial<{
    videoId: string;
    status: "playing" | "paused" | "ended";
    positionSeconds: number;
    baseRevision: number;
    durationSeconds: number | null;
  }> = {}
) =>
  as(userId).updateYoutubeState({
    roomId,
    videoId: VIDEO,
    status: "playing",
    positionSeconds: 0,
    baseRevision: 1,
    ...over,
  });
// The state was changed this many seconds ago (the server's clock).
const ago = (seconds: number) =>
  test.client.query(
    `UPDATE study_rooms SET "youtubeState" = jsonb_set("youtubeState", '{stateChangedAt}',
       to_jsonb(to_char((now() - make_interval(secs => $2)) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
     WHERE id = $1`,
    [roomId, seconds]
  );

describe("checking a link before it is added", () => {
  it("says which video it is, with a clean title and YouTube's own picture", async () => {
    const info = await as(AHMED).checkYoutube({
      roomId,
      link: `https://youtu.be/${VIDEO}?si=xyz`,
    });
    expect(info).toEqual({
      videoId: VIDEO,
      title: `Lecture b ${VIDEO} /b`,
      thumbnail: `https://i.ytimg.com/vi/${VIDEO}/hqdefault.jpg`,
    });
    // One request, to YouTube's own address, with the id and nothing else.
    expect(asked).toHaveLength(1);
    expect(new URL(asked[0]).origin).toBe("https://www.youtube.com");
    expect(new URL(asked[0]).pathname).toBe("/oembed");
  });

  it("refuses what is not a YouTube video link, without asking anyone", async () => {
    for (const link of [
      "https://vimeo.com/123456789",
      `https://evil.example/watch?v=${VIDEO}`,
      "javascript:alert(1)",
      "just words",
    ]) {
      expect(await refusal(as(AHMED).checkYoutube({ roomId, link }))).toBe(
        "BAD_REQUEST:video_invalid"
      );
    }
    expect(asked).toHaveLength(0);
  });

  it("says so when the video is private or forbids embedding, or is gone", async () => {
    expect(
      await refusal(
        as(AHMED).checkYoutube({ roomId, link: `https://youtu.be/${PRIVATE}` })
      )
    ).toBe("BAD_REQUEST:video_no_embed");
    expect(
      await refusal(
        as(AHMED).checkYoutube({ roomId, link: `https://youtu.be/${GONE}` })
      )
    ).toBe("BAD_REQUEST:video_unavailable");
  });

  it("is only for who could add it", async () => {
    expect(
      await refusal(
        as(SARA).checkYoutube({ roomId, link: `https://youtu.be/${VIDEO}` })
      )
    ).toBe("FORBIDDEN:not_allowed");
    expect(
      await refusal(
        as(OUTSIDER).checkYoutube({ roomId, link: `https://youtu.be/${VIDEO}` })
      )
    ).toBe("NOT_FOUND:not_available");
    expect(asked).toHaveLength(0);
  });

  it("when YouTube cannot be reached the video is still accepted, untitled", async () => {
    youtubeDown = true;
    expect(
      await as(AHMED).checkYoutube({
        roomId,
        link: `https://youtu.be/${VIDEO}`,
      })
    ).toMatchObject({ videoId: VIDEO, title: null });
  });
});

describe("putting a video in the room", () => {
  it("the leader adds it; it starts paused at the beginning, for everyone", async () => {
    const added = await addVideo();
    expect(added).toMatchObject({
      contentType: "youtube",
      videoId: VIDEO,
      title: `Lecture b ${VIDEO} /b`,
    });
    expect(added.state).toMatchObject({
      status: "paused",
      positionSeconds: 0,
      revision: 1,
      controlledBy: AHMED,
    });
    // Every member's reading of the room carries it.
    const seen = (await as(SARA).state({ roomId })).video;
    expect(seen).toMatchObject({ contentType: "youtube", videoId: VIDEO });
    expect(seen.state?.revision).toBe(1);
    expect(Math.abs(seen.serverNow - Date.now())).toBeLessThan(5000);
    expect(await as(OMAR).youtubeState({ roomId })).toMatchObject({
      videoId: VIDEO,
    });
  });

  it("a member may not add, replace, switch or remove it; an outsider sees nothing", async () => {
    expect(
      await refusal(
        as(SARA).setContent({ roomId, contentType: "youtube", videoId: VIDEO })
      )
    ).toBe("FORBIDDEN:not_allowed");
    await addVideo();
    expect(
      await refusal(as(SARA).setContent({ roomId, contentType: "pdf" }))
    ).toBe("FORBIDDEN:not_allowed");
    expect(await refusal(as(SARA).clearContent({ roomId }))).toBe(
      "FORBIDDEN:not_allowed"
    );
    expect(await refusal(as(OUTSIDER).youtubeState({ roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
    expect((await as(AHMED).youtubeState({ roomId })).videoId).toBe(VIDEO);
  });

  it("a private or deleted video is not put in the room", async () => {
    expect(await refusal(addVideo(PRIVATE))).toBe("BAD_REQUEST:video_no_embed");
    expect(await refusal(addVideo(GONE))).toBe("BAD_REQUEST:video_unavailable");
    expect((await as(AHMED).state({ roomId })).video).toMatchObject({
      contentType: "pdf",
      videoId: null,
      state: null,
    });
  });

  it("an id of the wrong shape never reaches the server's code", async () => {
    for (const videoId of [
      "",
      "short",
      `${VIDEO}x`,
      "<script>ab1",
      "../../etc/x",
    ]) {
      await expect(
        as(AHMED).setContent({ roomId, contentType: "youtube", videoId })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(asked).toHaveLength(0);
  });

  it("does not touch the room's file, and the file comes back as it was", async () => {
    await as(AHMED).setPage({ roomId, page: 2 });
    await addVideo();
    const during = await as(SARA).state({ roomId });
    expect(during.room.bookId).toBe(BOOK);
    expect(during.room.sharedPage).toBe(2);
    expect((await as(SARA).file({ roomId }))?.sharedPage).toBe(2);

    // Back to the file: the video stays in the room, the file is as it was.
    const back = await as(AHMED).setContent({ roomId, contentType: "pdf" });
    expect(back).toMatchObject({ contentType: "pdf", videoId: VIDEO });
    expect((await as(SARA).state({ roomId })).room.sharedPage).toBe(2);
    // And to the video again, without adding it a second time.
    asked.length = 0;
    expect(
      await as(AHMED).setContent({ roomId, contentType: "youtube" })
    ).toMatchObject({ contentType: "youtube", videoId: VIDEO });
    expect(asked).toHaveLength(0);

    await as(AHMED).clearContent({ roomId });
    const after = await as(SARA).state({ roomId });
    expect(after.video).toMatchObject({
      contentType: "pdf",
      videoId: null,
      state: null,
    });
    expect(after.room.bookId).toBe(BOOK);
    expect(after.room.sharedPage).toBe(2);
  });

  it("showing a video the room does not have is refused", async () => {
    expect(
      await refusal(as(AHMED).setContent({ roomId, contentType: "youtube" }))
    ).toBe("PRECONDITION_FAILED:no_video");
  });

  it("is written in the room's log", async () => {
    await addVideo();
    await addVideo(OTHER);
    await as(AHMED).clearContent({ roomId });
    const log = await test.client.query<{ type: string; data: unknown }>(
      `SELECT type, data FROM study_room_events
       WHERE "roomId" = $1 AND type LIKE 'video_%' ORDER BY id`,
      [roomId]
    );
    expect(log.rows).toEqual([
      { type: "video_set", data: { videoId: VIDEO, replaced: null } },
      { type: "video_set", data: { videoId: OTHER, replaced: VIDEO } },
      { type: "video_clear", data: { videoId: OTHER } },
    ]);
  });
});

describe("play, pause and seek", () => {
  beforeEach(async () => {
    await addVideo();
  });

  it("the leader plays; everyone's screen is told where the video is now", async () => {
    const played = await change(AHMED, { positionSeconds: 12.34 });
    expect(played.applied).toBe(true);
    expect(played.state).toMatchObject({
      status: "playing",
      positionSeconds: 12.3,
      revision: 2,
      controlledBy: AHMED,
    });
    // The time of the change is the server's, not the phone's.
    expect(
      Math.abs(Date.parse(played.state!.stateChangedAt) - Date.now())
    ).toBeLessThan(5000);

    // A member who joins half a minute later starts in the right place.
    await ago(30);
    const late = await as(OMAR).youtubeState({ roomId });
    const now = expectedPosition(late.state!, late.serverNow);
    expect(now).toBeGreaterThan(42);
    expect(now).toBeLessThan(44);
  });

  it("pause holds the place; seek moves it; the end is the end", async () => {
    await change(AHMED, { positionSeconds: 10 });
    const paused = await change(AHMED, {
      status: "paused",
      positionSeconds: 95.5,
      baseRevision: 2,
    });
    expect(paused.state).toMatchObject({ status: "paused", revision: 3 });
    await ago(600);
    const later = await as(SARA).youtubeState({ roomId });
    expect(expectedPosition(later.state!, later.serverNow)).toBe(95.5);

    const sought = await change(AHMED, {
      status: "paused",
      positionSeconds: 300,
      baseRevision: 3,
    });
    expect(sought.state).toMatchObject({ positionSeconds: 300, revision: 4 });

    const ended = await change(AHMED, {
      status: "ended",
      positionSeconds: 600,
      baseRevision: 4,
      durationSeconds: 600,
    });
    expect(ended.state).toMatchObject({
      status: "ended",
      positionSeconds: 600,
      durationSeconds: 600,
      revision: 5,
    });
    await ago(120);
    const over = await as(OMAR).youtubeState({ roomId });
    expect(expectedPosition(over.state!, over.serverNow)).toBe(600);
  });

  it("a member cannot control it, nor someone outside or who has left", async () => {
    expect(await refusal(change(SARA))).toBe("FORBIDDEN:not_allowed");
    expect(await refusal(as(SARA).syncYoutube({ roomId }))).toBe(
      "FORBIDDEN:not_allowed"
    );
    expect(await refusal(change(OUTSIDER))).toBe("NOT_FOUND:not_available");
    await as(OMAR).leave({ roomId });
    expect(await refusal(change(OMAR))).toBe("NOT_FOUND:not_available");
    expect((await as(AHMED).youtubeState({ roomId })).state?.revision).toBe(1);
  });

  it("members control it only when the room says so", async () => {
    await as(AHMED).update({ roomId, settings: { videoControl: "members" } });
    expect((await as(SARA).state({ roomId })).me.can.control_video).toBe(true);
    expect((await change(SARA, { positionSeconds: 5 })).applied).toBe(true);
    // Adding or removing the video is still the leader's.
    expect(await refusal(as(SARA).clearContent({ roomId }))).toBe(
      "FORBIDDEN:not_allowed"
    );
    await as(AHMED).update({ roomId, settings: { videoControl: "host" } });
    expect((await as(SARA).state({ roomId })).me.can.control_video).toBe(false);
    expect(await refusal(change(SARA, { baseRevision: 2 }))).toBe(
      "FORBIDDEN:not_allowed"
    );
  });

  it("an old event never undoes a newer one", async () => {
    await change(AHMED, { positionSeconds: 50 }); // → revision 2
    // A slow phone sends "pause at 3" against the state it saw long ago.
    const stale = await change(AHMED, {
      status: "paused",
      positionSeconds: 3,
      baseRevision: 1,
    });
    expect(stale.applied).toBe(false);
    // …and is told how things are.
    expect(stale.state).toMatchObject({
      status: "playing",
      positionSeconds: 50,
      revision: 2,
    });
    expect((await as(SARA).youtubeState({ roomId })).state).toMatchObject({
      status: "playing",
      positionSeconds: 50,
      revision: 2,
    });
  });

  it("two presses at the same instant: exactly one is applied", async () => {
    const results = await Promise.all([
      change(AHMED, { positionSeconds: 10 }),
      change(AHMED, { status: "paused", positionSeconds: 20 }),
    ]);
    expect(results.filter(result => result.applied)).toHaveLength(1);
    expect((await as(AHMED).youtubeState({ roomId })).state?.revision).toBe(2);
  });

  it("a change meant for a video that has been replaced is not applied", async () => {
    await addVideo(OTHER); // revision 2, paused at 0
    const meantForOld = await change(AHMED, {
      videoId: VIDEO,
      positionSeconds: 77,
      baseRevision: 2,
    });
    expect(meantForOld.applied).toBe(false);
    expect(meantForOld).toMatchObject({ videoId: OTHER });
    expect(meantForOld.state).toMatchObject({
      status: "paused",
      positionSeconds: 0,
    });
  });

  it("a new video starts from zero, whatever the old one was doing", async () => {
    await change(AHMED, { positionSeconds: 400 });
    const next = await addVideo(OTHER);
    expect(next).toMatchObject({ videoId: OTHER });
    expect(next.state).toMatchObject({
      status: "paused",
      positionSeconds: 0,
      durationSeconds: null,
      revision: 3,
    });
  });

  it("a place that cannot be is refused", async () => {
    for (const positionSeconds of [-1, NaN, Infinity, 90_000]) {
      await expect(change(AHMED, { positionSeconds })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
    // Past the end of a video whose length is known.
    await change(AHMED, { positionSeconds: 10, durationSeconds: 120 });
    expect(
      await refusal(change(AHMED, { positionSeconds: 500, baseRevision: 2 }))
    ).toBe("BAD_REQUEST:video_bad_position");
    // The length, once told, is not changed by a later claim.
    const kept = await change(AHMED, {
      positionSeconds: 30,
      baseRevision: 2,
      durationSeconds: 9999,
    });
    expect(kept.state?.durationSeconds).toBe(120);
  });

  it("nothing can be changed where there is no video", async () => {
    await as(AHMED).clearContent({ roomId });
    expect(await refusal(change(AHMED))).toBe("PRECONDITION_FAILED:no_video");
    expect(await refusal(as(AHMED).syncYoutube({ roomId }))).toBe(
      "PRECONDITION_FAILED:no_video"
    );
  });

  it('"bring everyone here" re-states where the video is, as a new revision', async () => {
    await change(AHMED, { positionSeconds: 100 }); // playing, revision 2
    await ago(20);
    const synced = await as(AHMED).syncYoutube({ roomId });
    expect(synced.applied).toBe(true);
    expect(synced.state).toMatchObject({ status: "playing", revision: 3 });
    expect(synced.state!.positionSeconds).toBeGreaterThan(119);
    expect(synced.state!.positionSeconds).toBeLessThan(122);
  });

  it("turning to the file stops a playing video where it is", async () => {
    await change(AHMED, { positionSeconds: 60 });
    await ago(10);
    const back = await as(AHMED).setContent({ roomId, contentType: "pdf" });
    expect(back.state).toMatchObject({ status: "paused", revision: 3 });
    expect(back.state!.positionSeconds).toBeGreaterThan(69);
    expect(back.state!.positionSeconds).toBeLessThan(72);
  });
});

describe("the room around the video", () => {
  beforeEach(async () => {
    await addVideo();
  });

  it("when the leader leaves, whoever leads next controls the video", async () => {
    await change(AHMED, { positionSeconds: 40 });
    await as(AHMED).leave({ roomId });
    const state = await as(SARA).state({ roomId });
    expect(state.room.hostId).toBe(SARA);
    expect(state.me.can.control_video).toBe(true);
    // The video is still there, still playing from where it was.
    expect(state.video.state).toMatchObject({ status: "playing", revision: 2 });
    expect(
      (
        await change(SARA, {
          status: "paused",
          positionSeconds: 55,
          baseRevision: 2,
        })
      ).applied
    ).toBe(true);
    // The one who left controls nothing.
    expect(await refusal(change(AHMED, { baseRevision: 3 }))).toBe(
      "NOT_FOUND:not_available"
    );
  });

  it("someone removed from the room loses the video with it", async () => {
    await as(AHMED).remove({ roomId, userId: OMAR, ban: false });
    expect(await refusal(as(OMAR).youtubeState({ roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
  });

  it("when the room ends, nothing of the video can be read or changed", async () => {
    await change(AHMED, { positionSeconds: 5 });
    await as(AHMED).end({ roomId });
    for (const userId of [AHMED, SARA]) {
      expect(await refusal(as(userId).youtubeState({ roomId }))).toBe(
        "NOT_FOUND:not_available"
      );
      expect(await refusal(change(userId, { baseRevision: 2 }))).toBe(
        "NOT_FOUND:not_available"
      );
    }
    expect(await refusal(addVideo(OTHER))).toBe("NOT_FOUND:not_available");
  });

  it("a chat message carries the place in the video it was written at", async () => {
    await as(SARA).sendMessage({
      roomId,
      body: "ما معنى هذا؟",
      videoSeconds: 754.8,
      clientId: cid(),
    });
    await as(OMAR).sendMessage({ roomId, body: "بلا وقت", clientId: cid() });
    const messages = await as(AHMED).messages({ roomId });
    expect(messages.map(message => message.videoSeconds)).toEqual([754, null]);
  });

  it("the file, the page, highlights and chat still work beside the video", async () => {
    await as(AHMED).setContent({ roomId, contentType: "pdf" });
    await as(AHMED).setPage({ roomId, page: 3 });
    await as(SARA).addMark({
      roomId,
      page: 3,
      color: "yellow",
      rects: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.03 }],
      clientId: cid(),
    });
    await as(OMAR).sendMessage({
      roomId,
      body: "تمام",
      page: 3,
      clientId: cid(),
    });
    expect((await as(OMAR).file({ roomId }))?.sharedPage).toBe(3);
    expect(await as(OMAR).marks({ roomId, page: 3 })).toHaveLength(1);
    expect((await as(SARA).messages({ roomId }))[0]).toMatchObject({
      page: 3,
      videoSeconds: null,
    });
    const summary = await as(SARA).summary({ roomId });
    expect(summary.file).toMatchObject({ lastPage: 3 });
  });
});
