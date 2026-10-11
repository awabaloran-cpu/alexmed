import "@/app/globals.css";
import BottomNav from "@/components/BottomNav";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

// 🧭 Discover shell (lib/discover) — the same auth check + BottomNav as
// app/games. The study screens (learn, flashcards) cover the bar
// themselves while they are up.
export default async function DiscoverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="app-shell">
      {/* The pages run edge to edge and keep their own gutters. */}
      <main className="main-content discover-main">{children}</main>
      <BottomNav />
    </div>
  );
}
