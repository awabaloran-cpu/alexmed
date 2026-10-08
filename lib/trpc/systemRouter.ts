import { z } from "zod";
import { verifyDiagnostics } from "../sms/vonage";
import { adminProcedure, publicProcedure, router } from "./trpc";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  // Admin only: how sign-up codes are configured to be sent, and — when
  // Vonage refused the WhatsApp workflow and the code went out by SMS
  // instead — what Vonage said. Settings and the provider's error text
  // only; never a secret or a phone number.
  verifyDiagnostics: adminProcedure.query(() => verifyDiagnostics()),
});
