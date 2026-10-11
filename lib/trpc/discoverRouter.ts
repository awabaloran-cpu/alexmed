// 🧭 Discover (lib/discover): the catalogue of ready quizzes. Read by any
// signed-in student; the only things a student writes are their own
// follows and a play counted once in a while.
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  channelPage,
  discoverPage,
  followChannel,
  quizDetail,
  quizQuestions,
  recordPlay,
  searchQuizzes,
} from "../discover/data";
import { protectedProcedure, router } from "./trpc";

const language = z.enum(["ar", "en"]);
const slug = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9-]+$/);

function found<T>(value: T | null): T {
  if (value === null) {
    throw new TRPCError({ code: "NOT_FOUND", message: "not_found" });
  }
  return value;
}

export const discoverRouter = router({
  page: protectedProcedure
    .input(z.object({ language }))
    .query(({ input }) => discoverPage(input.language)),

  search: protectedProcedure
    .input(
      z.object({
        language,
        query: z.string().trim().max(64).optional(),
        // Any subject the catalogue names — it may run ahead of this build.
        category: z
          .string()
          .regex(/^[a-z0-9_-]{1,24}$/)
          .optional(),
        tag: z.string().max(48).optional(),
      })
    )
    .query(({ input: { language: lang, ...rest } }) =>
      searchQuizzes(lang, rest)
    ),

  quiz: protectedProcedure
    .input(z.object({ slug }))
    .query(async ({ input }) => found(await quizDetail(input.slug))),

  questions: protectedProcedure
    .input(z.object({ slug }))
    .query(async ({ ctx, input }) => {
      const quiz = found(await quizQuestions(input.slug, ctx.user.id));
      if (quiz === "playing") {
        // This quiz is being played in the student's room right now.
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "playing",
        });
      }
      return quiz;
    }),

  played: protectedProcedure
    .input(z.object({ slug }))
    .mutation(({ ctx, input }) => recordPlay(ctx.user.id, input.slug)),

  channel: protectedProcedure
    .input(z.object({ slug }))
    .query(async ({ ctx, input }) =>
      found(await channelPage(input.slug, ctx.user.id))
    ),

  follow: protectedProcedure
    .input(z.object({ slug, follow: z.boolean() }))
    .mutation(async ({ ctx, input }) =>
      found(await followChannel(ctx.user.id, input.slug, input.follow))
    ),
});
