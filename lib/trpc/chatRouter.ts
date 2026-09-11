import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  appendChatMessage,
  createCardFromChatMessage,
  createNoteFromChatMessage,
  getChatSessionForUser,
  getOrCreateChatSession,
  listChatMessages,
  type ChatTarget,
} from "../db-chat";
import { invokeLLM } from "../llm";
import {
  buildContextBlock,
  buildRagSystemPrompt,
  getPageChunk,
  NO_EVIDENCE_MESSAGE_AR,
  searchBookPages,
  searchChapterPages,
  searchSubjectPages,
} from "../rag";
import { protectedProcedure, router } from "./trpc";

const targetSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("page"), pageId: z.string() }),
  z.object({ scope: z.literal("chapter"), chapterId: z.string() }),
  z.object({ scope: z.literal("book"), bookId: z.string() }),
  z.object({ scope: z.literal("subject"), subjectId: z.string() }),
]);

// Bounded conversation memory — enough for the model to follow a "اختبرني"
// back-and-forth without an unbounded (and increasingly expensive) prompt.
const HISTORY_MESSAGE_LIMIT = 10;

export const chatRouter = router({
  getOrCreateSession: protectedProcedure
    .input(targetSchema)
    .mutation(async ({ ctx, input }) => {
      const session = await getOrCreateChatSession(
        ctx.user.id,
        input as ChatTarget
      );
      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Target not found" });
      }
      return session;
    }),

  listMessages: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      return listChatMessages(ctx.user.id, input.sessionId);
    }),

  // The core RAG call — retrieves scoped context, and only calls the LLM at
  // all when real evidence was found (see lib/rag.ts's NO_EVIDENCE_MESSAGE_AR
  // path below), so a question with no matching source never spends an AI
  // call just to say "I don't know".
  ask: protectedProcedure
    .input(
      z.object({ sessionId: z.string(), question: z.string().min(1).max(2000) })
    )
    .mutation(async ({ ctx, input }) => {
      const session = await getChatSessionForUser(ctx.user.id, input.sessionId);
      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      const userMessage = await appendChatMessage(session.id, {
        role: "user",
        content: input.question,
      });

      const chunks =
        session.scope === "page"
          ? await getPageChunk(session.pageId!)
          : session.scope === "chapter"
            ? await searchChapterPages(session.chapterId!, input.question)
            : session.scope === "book"
              ? await searchBookPages(session.bookId!, input.question)
              : await searchSubjectPages(session.subjectId!, input.question);

      if (!chunks.length) {
        const assistantMessage = await appendChatMessage(session.id, {
          role: "assistant",
          content: NO_EVIDENCE_MESSAGE_AR,
        });
        return { userMessage, assistantMessage };
      }

      const history = await listChatMessages(ctx.user.id, session.id);
      const recentHistory = history
        .slice(0, -1) // exclude the user message we just appended (added below)
        .slice(-HISTORY_MESSAGE_LIMIT)
        .map(m => ({ role: m.role, content: m.content }) as const);

      const response = await invokeLLM({
        messages: [
          { role: "system", content: buildRagSystemPrompt(session.scope) },
          ...recentHistory,
          {
            role: "user",
            content: `SOURCE EXCERPTS:\n${buildContextBlock(chunks)}\n\nQUESTION: ${input.question}`,
          },
        ],
        max_tokens: 1500,
      });

      const answer =
        response.choices[0]?.message.content?.trim() || NO_EVIDENCE_MESSAGE_AR;
      const citedPages = chunks.map(chunk => ({
        bookId: chunk.bookId,
        pageNumber: chunk.pageNumber,
      }));
      const assistantMessage = await appendChatMessage(session.id, {
        role: "assistant",
        content: answer,
        citedPages,
      });

      return { userMessage, assistantMessage };
    }),

  createNoteFromMessage: protectedProcedure
    .input(z.object({ messageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const note = await createNoteFromChatMessage(
        ctx.user.id,
        input.messageId
      );
      if (!note) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot create a note from this message",
        });
      }
      return note;
    }),

  createCardFromMessage: protectedProcedure
    .input(z.object({ messageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const card = await createCardFromChatMessage(
        ctx.user.id,
        input.messageId
      );
      if (!card) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot create a card from this message",
        });
      }
      return card;
    }),
});
