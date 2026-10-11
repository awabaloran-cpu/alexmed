// 🤝 Colleagues (lib/colleagues.ts). "Who" is always the session's user —
// the client only names the other student or the request it acts on, and
// the data layer checks that against the caller again. A refusal carries
// its reason key as the message; the pages translate it.
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  allowSearch,
  blockUser,
  cancelColleagueRequest,
  ColleagueError,
  listColleagueRequests,
  listColleagues,
  removeColleague,
  reportPerson,
  requestColleague,
  respondToColleague,
  searchPeople,
} from "../colleagues";
import { REPORT_REASONS } from "../study-rooms/config";
import { protectedProcedure, router } from "./trpc";

async function run<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ColleagueError) {
      throw new TRPCError({ code: error.code, message: error.reason });
    }
    throw error;
  }
}

const uuid = z.string().uuid();

export const colleaguesRouter = router({
  list: protectedProcedure.query(({ ctx }) => listColleagues(ctx.user.id)),

  requests: protectedProcedure.query(({ ctx }) =>
    listColleagueRequests(ctx.user.id)
  ),

  search: protectedProcedure
    .input(z.object({ query: z.string().max(64) }))
    .query(({ ctx, input }) => {
      if (!allowSearch(ctx.user.id)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "rate_limited",
        });
      }
      return searchPeople(ctx.user.id, input.query);
    }),

  request: protectedProcedure
    .input(z.object({ userId: uuid }))
    .mutation(({ ctx, input }) =>
      run(() => requestColleague(ctx.user.id, input.userId))
    ),

  respond: protectedProcedure
    .input(
      z.object({
        connectionId: uuid,
        decision: z.enum(["accept", "decline"]),
        block: z.boolean().default(false),
      })
    )
    .mutation(({ ctx, input }) =>
      run(() =>
        respondToColleague(
          ctx.user.id,
          input.connectionId,
          input.decision,
          input.decision === "decline" && input.block
        )
      )
    ),

  cancel: protectedProcedure
    .input(z.object({ connectionId: uuid }))
    .mutation(({ ctx, input }) =>
      run(() => cancelColleagueRequest(ctx.user.id, input.connectionId))
    ),

  remove: protectedProcedure
    .input(z.object({ userId: uuid }))
    .mutation(({ ctx, input }) =>
      run(() => removeColleague(ctx.user.id, input.userId))
    ),

  block: protectedProcedure
    .input(z.object({ userId: uuid }))
    .mutation(({ ctx, input }) =>
      run(() => blockUser(ctx.user.id, input.userId))
    ),

  report: protectedProcedure
    .input(
      z.object({
        userId: uuid,
        reason: z.enum(REPORT_REASONS),
        details: z.string().trim().max(500).nullish(),
      })
    )
    .mutation(({ ctx, input }) =>
      run(() =>
        reportPerson(ctx.user.id, {
          targetId: input.userId,
          reason: input.reason,
          details: input.details,
        })
      )
    ),
});
