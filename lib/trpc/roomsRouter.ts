// 👥 Study Rooms (docs/study-rooms). Every procedure: the feature is on →
// the viewer is read once (age group, gender, bans) → the function in
// lib/study-rooms decides on the server and refuses with a RoomError, which
// becomes a tRPC error whose message is the stable reason key the page
// translates.
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  REPORT_REASONS,
  ROOM_CAPACITY_MAX,
  ROOM_CAPACITY_MIN,
  ROOM_LANGUAGES,
  ROOM_TITLE_MAX,
  ROOM_TITLE_MIN,
  studyRoomsEnabled,
} from "../study-rooms/config";
import { RoomError } from "../study-rooms/errors";
import {
  banFromRooms,
  listReports,
  reportRoom,
  resolveReport,
  unbanFromRooms,
} from "../study-rooms/moderation";
import { adminSetProfile, getViewer, setProfile } from "../study-rooms/profile";
import {
  createRoom,
  createRoomForBook,
  endRoom,
  exploreRooms,
  joinRoom,
  leaveRoom,
  listSections,
  myRooms,
  previewRoom,
  removeMember,
  roomState,
  rotateInvite,
  setMember,
  suggestSubjects,
  transferHost,
  updateRoom,
} from "../study-rooms/rooms";
import {
  protectedProcedure,
  roomsAdminProcedure,
  roomsProcedure,
  router,
} from "./trpc";

function asTrpcError(error: unknown): never {
  if (error instanceof RoomError) {
    throw new TRPCError({ code: error.code, message: error.reason });
  }
  throw error;
}

const guard = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    return asTrpcError(error);
  }
};

const uuid = z.string().uuid();
const shortText = (max: number) => z.string().trim().max(max);
const settings = z
  .object({
    freeNav: z.boolean(),
    marks: z.boolean(),
    chat: z.boolean(),
    speak: z.enum(["open", "request", "host"]),
    quizStart: z.enum(["host", "cohost"]),
    invite: z.enum(["host", "anyone"]),
  })
  .partial();
const grants = z
  .object({
    chat: z.boolean(),
    mark: z.boolean(),
    speak: z.boolean(),
    lead: z.boolean(),
  })
  .partial();

export const roomsRouter = router({
  // Whether the feature exists for this server — the only procedure that
  // answers while it is off, so pages can hide their links.
  enabled: protectedProcedure.query(() => ({ enabled: studyRoomsEnabled() })),

  me: roomsProcedure.query(({ ctx }) => guard(() => getViewer(ctx.user.id))),

  setProfile: roomsProcedure
    .input(
      z.object({
        country: z
          .string()
          .regex(/^[A-Za-z]{2}$/)
          .optional(),
        uiLanguage: z.enum(["ar", "en"]).optional(),
        gender: z.enum(["female", "male"]).optional(),
        birthDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        stage: z.enum(["university", "high_school"]).optional(),
        acceptRules: z.boolean().optional(),
      })
    )
    .mutation(({ ctx, input }) => guard(() => setProfile(ctx.user.id, input))),

  sections: roomsProcedure.query(({ ctx }) =>
    guard(async () => listSections(await getViewer(ctx.user.id)))
  ),

  suggestSubjects: roomsProcedure
    .input(z.object({ sectionId: uuid.optional(), q: shortText(60) }))
    .query(({ ctx, input }) =>
      guard(async () => suggestSubjects(await getViewer(ctx.user.id), input))
    ),

  explore: roomsProcedure
    .input(
      z
        .object({
          q: shortText(80).optional(),
          sectionId: uuid.optional(),
          subjectId: uuid.optional(),
          language: z.enum(ROOM_LANGUAGES).optional(),
          country: z
            .string()
            .regex(/^[A-Za-z]{2}$/)
            .optional(),
          university: shortText(120).optional(),
          womenOnly: z.boolean().optional(),
        })
        .optional()
    )
    .query(({ ctx, input }) =>
      guard(async () => exploreRooms(await getViewer(ctx.user.id), input ?? {}))
    ),

  mine: roomsProcedure.query(({ ctx }) =>
    guard(async () => myRooms(await getViewer(ctx.user.id)))
  ),

  create: roomsProcedure
    .input(
      z.object({
        visibility: z.enum(["public", "private"]),
        title: z.string().trim().min(ROOM_TITLE_MIN).max(ROOM_TITLE_MAX),
        sectionId: uuid,
        subjectId: uuid.nullish(),
        subjectText: shortText(80).nullish(),
        topic: shortText(80).nullish(),
        university: shortText(120).nullish(),
        courseCode: shortText(24).nullish(),
        language: z.enum(ROOM_LANGUAGES).optional(),
        womenOnly: z.boolean().optional(),
        capacity: z
          .number()
          .int()
          .min(ROOM_CAPACITY_MIN)
          .max(ROOM_CAPACITY_MAX)
          .optional(),
        bookId: uuid.nullish(),
      })
    )
    .mutation(({ ctx, input }) =>
      guard(async () => createRoom(await getViewer(ctx.user.id), input))
    ),

  createForBook: roomsProcedure
    .input(z.object({ bookId: uuid }))
    .mutation(({ ctx, input }) =>
      guard(async () =>
        createRoomForBook(await getViewer(ctx.user.id), input.bookId)
      )
    ),

  preview: roomsProcedure
    .input(
      z
        .object({
          roomId: uuid.optional(),
          invite: z.string().min(8).max(64).optional(),
        })
        .refine(value => !!value.roomId || !!value.invite)
    )
    .query(({ ctx, input }) =>
      guard(async () => previewRoom(await getViewer(ctx.user.id), input))
    ),

  join: roomsProcedure
    .input(
      z.object({ roomId: uuid, invite: z.string().min(8).max(64).optional() })
    )
    .mutation(({ ctx, input }) =>
      guard(async () => joinRoom(await getViewer(ctx.user.id), input))
    ),

  leave: roomsProcedure
    .input(z.object({ roomId: uuid }))
    .mutation(({ ctx, input }) =>
      guard(() => leaveRoom(ctx.user.id, input.roomId))
    ),

  state: roomsProcedure
    .input(z.object({ roomId: uuid }))
    .query(({ ctx, input }) =>
      guard(async () => roomState(await getViewer(ctx.user.id), input.roomId))
    ),

  update: roomsProcedure
    .input(
      z.object({
        roomId: uuid,
        title: z
          .string()
          .trim()
          .min(ROOM_TITLE_MIN)
          .max(ROOM_TITLE_MAX)
          .optional(),
        capacity: z
          .number()
          .int()
          .min(ROOM_CAPACITY_MIN)
          .max(ROOM_CAPACITY_MAX)
          .optional(),
        locked: z.boolean().optional(),
        settings: settings.optional(),
        bookId: uuid.nullable().optional(),
      })
    )
    .mutation(({ ctx, input: { roomId, ...changes } }) =>
      guard(async () =>
        updateRoom(await getViewer(ctx.user.id), roomId, changes)
      )
    ),

  rotateInvite: roomsProcedure
    .input(z.object({ roomId: uuid }))
    .mutation(({ ctx, input }) =>
      guard(async () => ({
        inviteCode: await rotateInvite(
          await getViewer(ctx.user.id),
          input.roomId
        ),
      }))
    ),

  setMember: roomsProcedure
    .input(
      z.object({
        roomId: uuid,
        userId: uuid,
        muted: z.boolean().optional(),
        grants: grants.optional(),
        role: z.enum(["cohost", "member"]).optional(),
      })
    )
    .mutation(({ ctx, input: { roomId, userId, ...changes } }) =>
      guard(async () =>
        setMember(await getViewer(ctx.user.id), roomId, userId, changes)
      )
    ),

  remove: roomsProcedure
    .input(z.object({ roomId: uuid, userId: uuid, ban: z.boolean() }))
    .mutation(({ ctx, input }) =>
      guard(async () =>
        removeMember(
          await getViewer(ctx.user.id),
          input.roomId,
          input.userId,
          input.ban
        )
      )
    ),

  transferHost: roomsProcedure
    .input(z.object({ roomId: uuid, userId: uuid }))
    .mutation(({ ctx, input }) =>
      guard(async () =>
        transferHost(await getViewer(ctx.user.id), input.roomId, input.userId)
      )
    ),

  end: roomsProcedure
    .input(z.object({ roomId: uuid }))
    .mutation(({ ctx, input }) =>
      guard(async () => endRoom(await getViewer(ctx.user.id), input.roomId))
    ),

  report: roomsProcedure
    .input(
      z.object({
        roomId: uuid,
        targetUserId: uuid.nullish(),
        reason: z.enum(REPORT_REASONS),
        details: shortText(500).nullish(),
      })
    )
    .mutation(({ ctx, input }) =>
      guard(async () => reportRoom(await getViewer(ctx.user.id), input))
    ),

  // ── Admin ──
  adminReports: roomsAdminProcedure
    .input(
      z
        .object({
          status: z.enum(["open", "actioned", "dismissed"]).optional(),
        })
        .optional()
    )
    .query(({ input }) => guard(() => listReports(input?.status ?? "open"))),

  adminResolve: roomsAdminProcedure
    .input(
      z.object({
        reportId: uuid,
        action: z.enum(["dismiss", "end_room", "ban_user", "unhide_room"]),
        banDays: z.number().int().min(1).max(3650).nullish(),
      })
    )
    .mutation(({ ctx, input }) =>
      guard(() => resolveReport(ctx.user.id, input))
    ),

  adminBan: roomsAdminProcedure
    .input(
      z.object({
        userId: uuid,
        days: z.number().int().min(1).max(3650).nullable(),
        reason: shortText(200).nullish(),
      })
    )
    .mutation(({ ctx, input }) =>
      guard(() => banFromRooms(ctx.user.id, input))
    ),

  adminUnban: roomsAdminProcedure
    .input(z.object({ userId: uuid }))
    .mutation(({ ctx, input }) =>
      guard(() => unbanFromRooms(ctx.user.id, input.userId))
    ),

  adminSetProfile: roomsAdminProcedure
    .input(
      z.object({
        userId: uuid,
        birthDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        gender: z.enum(["female", "male"]).optional(),
        stage: z.enum(["university", "high_school"]).optional(),
      })
    )
    .mutation(({ input: { userId, ...changes } }) =>
      guard(() => adminSetProfile(userId, changes))
    ),
});
