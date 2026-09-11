import AppSidebar from "@/components/AppSidebar";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

// Same shell as app/books/layout.tsx and app/subjects/layout.tsx.
export default async function TodayLayout({
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
      <AppSidebar />
      <main className="main-content">{children}</main>
    </div>
  );
}
