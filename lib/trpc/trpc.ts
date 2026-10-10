import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { AiRateLimitError } from "../ai/types";
import { BillingError } from "../billing/usage";
import { isApprovedDoctor } from "../db-doctors";
import { doctorSetsEnabled } from "../doctor-sets-config";
import { studyRoomsEnabled } from "../study-rooms/config";

export const INTERNAL_ERROR_MESSAGE = "حدث خطأ غير متوقع. حاول مرة أخرى.";
const AI_BUSY_MESSAGE = "المساعد مشغول الآن. حاول بعد قليل.";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  // Plan limits (lib/billing) travel to the client as structured data —
  // code, plan, limit, the plan that would lift it — so the UI can show the
  // right upgrade prompt instead of parsing messages.
  //
  // An unexpected exception (a database or provider error, a bug) is wrapped
  // by tRPC as INTERNAL_SERVER_ERROR with the original error as its cause;
  // its message can carry SQL, table names or upstream details, so the
  // client gets a generic message instead (the real one is logged by the
  // route's onError). Errors thrown on purpose as TRPCError keep theirs.
  errorFormatter({ shape, error }) {
    const unexpected =
      error.code === "INTERNAL_SERVER_ERROR" &&
      error.cause instanceof Error &&
      !(error.cause instanceof TRPCError);
    return {
      ...shape,
      message: !unexpected
        ? shape.message
        : error.cause instanceof AiRateLimitError
          ? AI_BUSY_MESSAGE
          : INTERNAL_ERROR_MESSAGE,
      data: {
        ...shape.data,
        stack: undefined,
        billing:
          error.cause instanceof BillingError ? error.cause.details : null,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

// 🔒 Protected Doctor Question Sets. While DOCTOR_SETS_ENABLED isn't "true"
// every procedure of the feature answers NOT_FOUND, as if it didn't exist.
const requireDoctorSetsEnabled = t.middleware(async ({ next }) => {
  if (!doctorSetsEnabled()) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
  }
  return next();
});

export const doctorSetsProcedure = protectedProcedure.use(
  requireDoctorSetsEnabled
);

// An approved doctor, read from doctor_profiles (and the account's own
// suspension) on EVERY call — never from the session, so an admin's
// suspension or approval applies to the very next request.
export const doctorProcedure = doctorSetsProcedure.use(
  t.middleware(async ({ ctx, next }) => {
    if (!ctx.user || !(await isApprovedDoctor(ctx.user.id))) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "هذه الصفحة للدكاترة المعتمدين فقط.",
      });
    }
    return next();
  })
);

// 👥 Study Rooms. While STUDY_ROOMS_ENABLED isn't "true" every procedure of
// the feature answers NOT_FOUND, as if it didn't exist.
const requireStudyRoomsEnabled = t.middleware(async ({ next }) => {
  if (!studyRoomsEnabled()) {
    throw new TRPCError({ code: "NOT_FOUND", message: "not_available" });
  }
  return next();
});

export const roomsProcedure = protectedProcedure.use(requireStudyRoomsEnabled);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  })
);

// Admin moderation of doctors / protected sets: admin AND the feature on.
export const adminDoctorSetsProcedure = adminProcedure.use(
  requireDoctorSetsEnabled
);

export const roomsAdminProcedure = adminProcedure.use(requireStudyRoomsEnabled);
