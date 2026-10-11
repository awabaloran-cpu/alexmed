// Who gets a pass into a room's voice, and what it lets them do — through
// the REAL router on a real Postgres (PGlite), with a real signed pass
// (nothing is sent to LiveKit: signing needs no network).
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
  insertUser,
  type TestDb,
} from "../test-fixtures/pglite-db";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({
  getDb: () => holder.db,
  requireDb: () => holder.db,
}));
// The voice room is never called from a test.
vi.mock("./voice", async importOriginal => {
  const actual = await importOriginal<typeof import("./voice")>();
  return { ...actual, syncVoiceSoon: vi.fn() };
});

import { roomsRouter } from "../trpc/roomsRouter";
import { syncVoiceSoon } from "./voice";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AHMED = id(1);
const SARA = id(2);
const OMAR = id(3);
const OUTSIDER = id(5);

let test: TestDb;
let medicine: string;
let roomId: string;
const saved = {
  url: process.env.LIVEKIT_URL,
  key: process.env.LIVEKIT_API_KEY,
  secret: process.env.LIVEKIT_API_SECRET,
};

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

// What a pass says, read back from the pass itself.
function read(token: string) {
  const payload = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString("utf8")
  ) as {
    sub: string;
    name?: string;
    exp: number;
    video: {
      room: string;
      roomJoin: boolean;
      canPublish: boolean;
      canSubscribe: boolean;
      canPublishData: boolean;
      canPublishSources?: string[];
    };
  };
  return payload;
}

beforeAll(async () => {
  test = await createTestDb();
  holder.db = test.db;
  process.env.STUDY_ROOMS_ENABLED = "true";
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
  const section = await test.client.query<{ id: string }>(
    `SELECT id FROM study_sections WHERE key = 'medicine'`
  );
  medicine = section.rows[0].id;
}, 120_000);

afterAll(() => {
  for (const [name, value] of [
    ["LIVEKIT_URL", saved.url],
    ["LIVEKIT_API_KEY", saved.key],
    ["LIVEKIT_API_SECRET", saved.secret],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

beforeEach(async () => {
  process.env.LIVEKIT_URL = "wss://voice.test";
  process.env.LIVEKIT_API_KEY = "APItestkey";
  process.env.LIVEKIT_API_SECRET = "a-test-secret-that-is-long-enough-000";
  vi.mocked(syncVoiceSoon).mockClear();
  await test.client.exec(
    `DELETE FROM study_room_events; DELETE FROM study_rooms; DELETE FROM user_blocks;`
  );
  // A room whose members may speak without asking (a public room starts
  // "by request").
  ({ roomId } = await as(AHMED).create({
    visibility: "public",
    title: "أدوية الكلى",
    sectionId: medicine,
  }));
  await as(AHMED).update({ roomId, settings: { speak: "open" } });
  await as(SARA).join({ roomId });
  await as(OMAR).join({ roomId });
  vi.mocked(syncVoiceSoon).mockClear();
});

describe("a pass into the room's voice", () => {
  it("is for this student and this room only, for sound from a microphone", async () => {
    const pass = (await as(SARA).voice({ roomId }))!;
    expect(pass.url).toBe("wss://voice.test");
    expect(pass.maySpeak).toBe(true);
    const said = read(pass.token);
    expect(said.sub).toBe(SARA);
    expect(said.name).toBe("سارة");
    expect(said.video).toMatchObject({
      room: roomId,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    expect(said.video.canPublishSources).toEqual(["microphone"]);
    // It ends: a sitting, not for good.
    const hours = (said.exp - Date.now() / 1000) / 3600;
    expect(hours).toBeGreaterThan(5);
    expect(hours).toBeLessThanOrEqual(6);
    // The server's secret is not in what the page receives.
    expect(JSON.stringify(pass)).not.toContain(
      "a-test-secret-that-is-long-enough-000"
    );
  });

  it("is not given to someone who is not in the room", async () => {
    expect(await refusal(as(OUTSIDER).voice({ roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
    await as(SARA).leave({ roomId });
    expect(await refusal(as(SARA).voice({ roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
    await as(AHMED).remove({ roomId, userId: OMAR, ban: true });
    expect(await refusal(as(OMAR).voice({ roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
    await as(AHMED).end({ roomId });
    // Ended: nobody is in it any more, its leader included.
    expect(await refusal(as(AHMED).voice({ roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
  });

  it("lets a muted student listen and not speak; the host's mute holds", async () => {
    await as(AHMED).setMember({ roomId, userId: SARA, muted: true });
    const muted = (await as(SARA).voice({ roomId }))!;
    expect(muted.maySpeak).toBe(false);
    expect(read(muted.token).video).toMatchObject({
      canPublish: false,
      canSubscribe: true,
    });
    await as(AHMED).setMember({ roomId, userId: SARA, muted: false });
    expect((await as(SARA).voice({ roomId }))!.maySpeak).toBe(true);
  });

  it("follows the room's setting: by request, only who the host lets speak", async () => {
    await as(AHMED).update({ roomId, settings: { speak: "request" } });
    expect((await as(SARA).voice({ roomId }))!.maySpeak).toBe(false);
    // The leader always may.
    expect((await as(AHMED).voice({ roomId }))!.maySpeak).toBe(true);
    await as(AHMED).setMember({
      roomId,
      userId: SARA,
      grants: { speak: true },
    });
    expect((await as(SARA).voice({ roomId }))!.maySpeak).toBe(true);
    expect((await as(OMAR).voice({ roomId }))!.maySpeak).toBe(false);
  });

  it("is not given at all while voice is not set up", async () => {
    delete process.env.LIVEKIT_API_SECRET;
    expect(await as(SARA).voice({ roomId })).toBeNull();
  });
});

describe("the voice room is brought into line", () => {
  it("after every change to who may be heard", async () => {
    const calls = () => vi.mocked(syncVoiceSoon).mock.calls.length;
    await as(AHMED).setMember({ roomId, userId: SARA, muted: true });
    expect(calls()).toBe(1);
    await as(AHMED).update({ roomId, settings: { speak: "host" } });
    expect(calls()).toBe(2);
    await as(AHMED).remove({ roomId, userId: OMAR, ban: false });
    expect(calls()).toBe(3);
    await as(SARA).leave({ roomId });
    expect(calls()).toBe(4);
    await as(AHMED).end({ roomId });
    expect(calls()).toBe(5);
    expect(vi.mocked(syncVoiceSoon)).toHaveBeenLastCalledWith(roomId);
  });

  it("but not after a change that was refused", async () => {
    expect(
      await refusal(as(SARA).setMember({ roomId, userId: OMAR, muted: true }))
    ).toBe("FORBIDDEN:not_allowed");
    expect(vi.mocked(syncVoiceSoon)).not.toHaveBeenCalled();
  });
});
