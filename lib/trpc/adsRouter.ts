import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  adEvents,
  books,
  telegramAccounts,
  telegramUploads,
} from "../../drizzle/schema";
import { readAdConfig, resolveAdBreakPolicy } from "../ads/policy";
import { getUserPlan } from "../billing/entitlement";
import { requireDb } from "../db";
import { protectedProcedure, router } from "./trpc";

// True when this file of the student's reached NiroLearn through the bot.
async function cameFromTelegram(userId: string, bookId: string) {
  const [row] = await requireDb()
    .select({ id: telegramUploads.id })
    .from(telegramUploads)
    .innerJoin(
      telegramAccounts,
      eq(telegramAccounts.id, telegramUploads.telegramAccountId)
    )
    .where(
      and(
        eq(telegramUploads.bookId, bookId),
        eq(telegramAccounts.userId, userId)
      )
    )
    .limit(1);
  return !!row;
}

// 📣 Ads (lib/ads/policy.ts). The viewer asks what to show between
// questions of one file and reports what was shown; it never decides.
export const adsRouter = router({
  questionBreakPolicy: protectedProcedure
    .input(
      z.object({
        bookId: z.string().uuid(),
        // ?adPreview=1 on a viewer. Honoured for admins only: shows the
        // break as a free student would see it, whatever the admin's own
        // plan — the only way to look at a break from a paid account.
        preview: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const config = readAdConfig(process.env);
      if (!config.enabled) return { enabled: false } as const;
      if (input.preview && ctx.user.role === "admin") {
        return resolveAdBreakPolicy({
          plan: { priceMonthlyCents: 0, features: {} },
          source: "telegram",
          config,
        });
      }
      const [plan, fromTelegram] = await Promise.all([
        getUserPlan(ctx.user.id),
        cameFromTelegram(ctx.user.id, input.bookId),
      ]);
      return resolveAdBreakPolicy({
        plan,
        source: fromTelegram ? "telegram" : "web",
        config,
      });
    }),

  // An impression or a click on a break — counts only (who, which file,
  // which provider). Clicks inside a Google unit happen in Google's own
  // frame and are reported by Google, not here.
  record: protectedProcedure
    .input(
      z.object({
        bookId: z.string().uuid(),
        provider: z.enum(["adsense", "house"]),
        event: z.enum(["impression", "click"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb();
      const [owned] = await db
        .select({ id: books.id })
        .from(books)
        .where(and(eq(books.id, input.bookId), eq(books.userId, ctx.user.id)))
        .limit(1);
      if (!owned) return { success: false } as const;
      await db.insert(adEvents).values({
        userId: ctx.user.id,
        bookId: input.bookId,
        provider: input.provider,
        slot: "question_break",
        event: input.event,
      });
      return { success: true } as const;
    }),
});
