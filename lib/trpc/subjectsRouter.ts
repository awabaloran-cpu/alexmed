import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createSubject,
  deleteSubject,
  getSubjectForUser,
  listSubjectsForUser,
  updateSubject,
} from "../db-subjects";
import { protectedProcedure, router } from "./trpc";

const subjectTypeSchema = z.enum([
  "general",
  "medical",
  "english",
  "mathematics",
  "aptitude",
  "programming",
  "custom",
]);

export const subjectsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return listSubjectsForUser(ctx.user.id);
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const subject = await getSubjectForUser(ctx.user.id, input.id);
      if (!subject) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Subject not found" });
      }
      return subject;
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        type: subjectTypeSchema.optional(),
        description: z.string().max(500).optional(),
        color: z.string().max(20).optional(),
        icon: z.string().max(40).optional(),
        examDate: z.string().datetime().optional(),
        targetDate: z.string().datetime().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const subject = await createSubject(ctx.user.id, {
        name: input.name,
        type: input.type,
        description: input.description,
        color: input.color,
        icon: input.icon,
        examDate: input.examDate ? new Date(input.examDate) : null,
        targetDate: input.targetDate ? new Date(input.targetDate) : null,
      });
      return subject;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(120).optional(),
        type: subjectTypeSchema.optional(),
        description: z.string().max(500).nullable().optional(),
        color: z.string().max(20).nullable().optional(),
        icon: z.string().max(40).nullable().optional(),
        examDate: z.string().datetime().nullable().optional(),
        targetDate: z.string().datetime().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      const ok = await updateSubject(ctx.user.id, id, {
        ...fields,
        examDate:
          fields.examDate !== undefined
            ? fields.examDate
              ? new Date(fields.examDate)
              : null
            : undefined,
        targetDate:
          fields.targetDate !== undefined
            ? fields.targetDate
              ? new Date(fields.targetDate)
              : null
            : undefined,
      });
      if (!ok) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Subject not found" });
      }
      return { success: true } as const;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await deleteSubject(ctx.user.id, input.id);
      if (!ok) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Subject not found" });
      }
      return { success: true } as const;
    }),
});
