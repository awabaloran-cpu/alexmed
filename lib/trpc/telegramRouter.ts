import { TRPCError } from "@trpc/server";
import {
  getTelegramLinkForUser,
  isTelegramGuest,
  unlinkTelegram,
} from "../telegram/accounts";
import { telegramBotUsername, telegramEnabled } from "../telegram/config";
import { createLinkToken } from "../telegram/tokens";
import {
  inviteLink,
  inviteStats,
  shareUrl,
  sourceLink,
  sourceReport,
} from "../telegram/growth";
import { TEXT } from "../telegram/messages";
import { adminProcedure, protectedProcedure, router } from "./trpc";

// One-time and short-lived: the code only has to survive the tap that
// carries it from /account to the bot.
const LINK_CODE_TTL_MINUTES = 10;

// ✈️ The /account side of the Telegram gateway: is this account connected,
// connect it, disconnect it. The bot side is lib/telegram/handler.ts.
export const telegramRouter = router({
  status: protectedProcedure.query(async ({ ctx }) => {
    const bot = telegramBotUsername();
    if (!telegramEnabled() || !bot) {
      return { available: false, linked: false, isGuest: false } as const;
    }
    const [link, isGuest] = await Promise.all([
      getTelegramLinkForUser(ctx.user.id),
      isTelegramGuest(ctx.user.id),
    ]);
    return {
      available: true,
      linked: !!link,
      isGuest,
      botUrl: `https://t.me/${bot}`,
    } as const;
  }),

  // A link that opens the bot carrying a one-time code for THIS account.
  createLink: protectedProcedure.mutation(async ({ ctx }) => {
    const bot = telegramBotUsername();
    if (!telegramEnabled() || !bot) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
    }
    const token = await createLinkToken({
      userId: ctx.user.id,
      purpose: "telegram_link",
      ttlMinutes: LINK_CODE_TTL_MINUTES,
    });
    return { url: `https://t.me/${bot}?start=link_${token}` } as const;
  }),

  // 🎁 What a "share" button on the site should send: the student's own
  // invite link when Telegram is connected (so a classmate who joins earns
  // them a file), otherwise a plain link to the bot labelled as coming
  // from the site.
  invite: protectedProcedure.query(async ({ ctx }) => {
    if (!telegramEnabled() || !telegramBotUsername()) {
      return { available: false } as const;
    }
    const account = await getTelegramLinkForUser(ctx.user.id);
    const link = account
      ? await inviteLink(account.id)
      : sourceLink("web_share");
    if (!link) return { available: false } as const;
    return {
      available: true,
      link,
      shareUrl: shareUrl(link, TEXT.inviteShare),
      text: TEXT.inviteShare,
      stats: account ? await inviteStats(account.id) : null,
    } as const;
  }),

  // 📈 Admin: where Telegram students came from (per campaign label) and
  // how far they got. Counts only.
  sources: adminProcedure.query(() => sourceReport()),

  unlink: protectedProcedure.mutation(async ({ ctx }) => {
    // A guest's only way in is Telegram; disconnecting would strand the
    // account and its files.
    if (await isTelegramGuest(ctx.user.id)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "أنشئ حسابك أولًا ثم افصل Telegram.",
      });
    }
    return { success: await unlinkTelegram(ctx.user.id) } as const;
  }),
});
