import AppSidebar from "@/components/AppSidebar";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

// Same shell as app/books/layout.tsx — one auth check, same shared sidebar.
export default async function SubjectsLayout({
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
