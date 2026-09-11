import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createAnnotation,
  createCardFromAnnotation,
  deleteAnnotation,
  listAnnotationsForPage,
  searchAnnotationsForSubject,
  updateAnnotation,
} from "../db-annotations";
import { protectedProcedure, router } from "./trpc";

export const annotationsRouter = router({
  listForPage: protectedProcedure
    .input(z.object({ pageId: z.string() }))
    .query(async ({ ctx, input }) => {
      return listAnnotationsForPage(ctx.user.id, input.pageId);
    }),

  create: protectedProcedure
    .input(
      z.object({
        bookId: z.string(),
        pageId: z.string(),
        type: z.enum(["highlight", "note"]),
        selectedText: z.string().max(2000).optional(),
        positionJson: z
          .object({ start: z.number().int(), end: z.number().int() })
          .optional(),
        content: z.string().max(5000).optional(),
        color: z.string().max(20).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const annotation = await createAnnotation(ctx.user.id, input);
      if (!annotation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Page not found" });
      }
      return annotation;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        content: z.string().max(5000).optional(),
        color: z.string().max(20).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      const ok = await updateAnnotation(ctx.user.id, id, fields);
      if (!ok) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Annotation not found",
        });
      }
      return { success: true } as const;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await deleteAnnotation(ctx.user.id, input.id);
      if (!ok) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Annotation not found",
        });
      }
      return { success: true } as const;
    }),

  searchInSubject: protectedProcedure
    .input(z.object({ subjectId: z.string(), query: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return searchAnnotationsForSubject(
        ctx.user.id,
        input.subjectId,
        input.query
      );
    }),

  createCard: protectedProcedure
    .input(z.object({ annotationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const card = await createCardFromAnnotation(
        ctx.user.id,
        input.annotationId
      );
      if (!card) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Annotation not found",
        });
      }
      return card;
    }),
});
