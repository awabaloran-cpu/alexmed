"use client";

import ErrorBoundary from "@/components/ErrorBoundary";
import ActiveRoomProvider from "@/components/rooms/ActiveRoom";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { SessionProvider } from "next-auth/react";
import { useState } from "react";
import superjson from "superjson";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
          fetch(input, init) {
            return globalThis.fetch(input, {
              ...(init ?? {}),
              credentials: "include",
            });
          },
        }),
      ],
    })
  );

  return (
    <ErrorBoundary>
      <SessionProvider>
        <trpc.Provider client={trpcClient} queryClient={queryClient}>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider defaultTheme="light">
              <TooltipProvider>
                <Toaster />
                {/* The study room the student is in, over every page. */}
                <ActiveRoomProvider>{children}</ActiveRoomProvider>
              </TooltipProvider>
            </ThemeProvider>
          </QueryClientProvider>
        </trpc.Provider>
      </SessionProvider>
    </ErrorBoundary>
  );
}
