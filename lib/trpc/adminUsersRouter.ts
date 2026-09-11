import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  deleteUserForAdmin,
  getPlatformStatsForAdmin,
  getUserDetailForAdmin,
  listUsersForAdmin,
  setUserPlanForAdmin,
  setUserSuspendedForAdmin,
} from "../db-admin-users";
import { adminProcedure, router } from "./trpc";

export const adminUsersRouter = router({
  stats: adminProcedure.query(async () => {
    return getPlatformStatsForAdmin();
  }),

  list: adminProcedure
    .input(
      z.object({
        search: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      })
    )
    .query(async ({ input }) => {
      return listUsersForAdmin(input);
    }),

  get: adminProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ input }) => {
      const detail = await getUserDetailForAdmin(input.userId);
      if (!detail) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      return detail;
    }),

  setPlan: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        plan: z.enum(["free", "premium"]),
        planExpiresAt: z.string().datetime().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      await setUserPlanForAdmin(
        input.userId,
        input.plan,
        input.planExpiresAt ? new Date(input.planExpiresAt) : null
      );
      return { ok: true };
    }),

  setSuspended: adminProcedure
    .input(z.object({ userId: z.string(), suspended: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot suspend your own account",
        });
      }
      await setUserSuspendedForAdmin(input.userId, input.suspended);
      return { ok: true };
    }),

  // Permanent, irreversible. The confirmation UX (typing the user's email)
  // lives client-side in app/admin/users/[userId]/page.tsx — this endpoint
  // itself just refuses to let an admin delete their own account, the one
  // guard that has to be server-side.
  delete: adminProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot delete your own account",
        });
      }
      const deleted = await deleteUserForAdmin(input.userId);
      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      return { ok: true };
    }),
});
