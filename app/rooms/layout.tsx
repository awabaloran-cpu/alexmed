import "@/app/globals.css";
import BottomNav from "@/components/BottomNav";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

// 👥 Study Rooms shell (docs/study-rooms) — same auth check + BottomNav as
// app/games. Whether the feature is switched on is asked by the pages
// themselves (components/rooms/RoomsProvider.tsx).
export default async function RoomsLayout({
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
      <main className="main-content">{children}</main>
      <BottomNav />
    </div>
  );
}
