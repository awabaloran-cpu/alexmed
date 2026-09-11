import AdminSidebar from "@/components/AdminSidebar";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

// Server-side gate for the whole /admin/* section — defense in depth on top
// of every adminProcedure/admin API route check (never the only check: a
// student who somehow reached a URL under /admin would still be rejected by
// every mutation/query behind it). Redirects unauthenticated users to
// /login (same as app/books/layout.tsx) and non-admins to "/" — never
// renders admin content, even a loading shell, for a non-admin session.
//
// The `dark` class here is what makes /admin visually its own product (see
// the ".dark" block in app/globals.css) — every other layout in the app
// stays on the default `:root` palette; this is the only place `dark` is
// ever applied, deliberately scoped to just this subtree.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== "admin") {
    redirect("/");
  }

  return (
    <div className="dark flex min-h-screen bg-background text-foreground">
      <AdminSidebar />
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
