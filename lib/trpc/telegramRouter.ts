import { TRPCError } from "@trpc/server";
import {
  getTelegramLinkForUser,
  isTelegramGuest,
  unlinkTelegram,
} from "../telegram/accounts";
import { telegramBotUsername, telegramEnabled } from "../telegram/config";
import { createLinkToken } from "../telegram/tokens";
import { protectedProcedure, router } from "./trpc";

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
