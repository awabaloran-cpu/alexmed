import BottomNav from "@/components/BottomNav";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

// Shared shell for the whole كتبي section — one auth check for every /books/*
// page. AppSidebar replaced with BottomNav (PR9) — navigation shape only,
// same app-shell/main-content classes (app/globals.css).
export default async function BooksLayout({
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
