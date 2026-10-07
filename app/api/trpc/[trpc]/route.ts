import { createContext } from "@/lib/trpc/context";
import { appRouter } from "@/lib/trpc/router";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

const PROTECTED_PREFIXES = [
  "questionSets.",
  "doctor.",
  "adminQuestionSets.",
  "adminDoctors.",
];

const handler = (request: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext,
    // 🔒 Protected question sets / doctor data must never be stored by a
    // browser or an intermediary cache (a revoked student, a shared
    // device). A batched response is no-store if any call in it is.
    responseMeta({ paths }) {
      const isProtected = (paths ?? []).some(path =>
        PROTECTED_PREFIXES.some(prefix => path.startsWith(prefix))
      );
      return isProtected
        ? { headers: new Headers({ "Cache-Control": "private, no-store" }) }
        : {};
    },
    // The client only sees a generic message for unexpected failures
    // (lib/trpc/trpc.ts's errorFormatter) — keep the real one in the logs.
    onError({ error, path }) {
      if (error.code === "INTERNAL_SERVER_ERROR") {
        console.error(`[tRPC] ${path ?? "?"} failed`, error.cause ?? error);
      }
    },
  });

export { handler as GET, handler as POST };
