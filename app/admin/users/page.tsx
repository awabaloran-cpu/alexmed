"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc-client";

const PAGE_SIZE = 25;

function formatDate(value: string | Date | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("ar", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function AdminUsersPage() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const usersQuery = trpc.adminUsers.list.useQuery({
    search: search || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const users = usersQuery.data?.users ?? [];
  const total = usersQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">المستخدمون</h1>
        <p className="text-sm text-muted-foreground">
          {total} مستخدم إجمالًا — ابحث بالبريد الإلكتروني أو الاسم.
        </p>
      </div>

      <form
        onSubmit={event => {
          event.preventDefault();
          setPage(0);
          setSearch(searchInput);
        }}
        className="flex max-w-sm items-center gap-2"
      >
        <div className="relative flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={searchInput}
            onChange={event => setSearchInput(event.target.value)}
            placeholder="ابحث..."
            className="pr-9"
          />
        </div>
      </form>

      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>البريد الإلكتروني</TableHead>
              <TableHead>الاسم</TableHead>
              <TableHead>الدور</TableHead>
              <TableHead>الخطة</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>تاريخ التسجيل</TableHead>
              <TableHead>آخر دخول</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usersQuery.isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  جاري التحميل...
                </TableCell>
              </TableRow>
            ) : !users.length ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  لا يوجد مستخدمون مطابقون.
                </TableCell>
              </TableRow>
            ) : (
              users.map(user => (
                <TableRow key={user.id} className="cursor-pointer">
                  <TableCell className="font-medium">
                    <Link
                      href={`/admin/users/${user.id}`}
                      className="hover:underline"
                    >
                      {user.email}
                    </Link>
                  </TableCell>
                  <TableCell>{user.name || "—"}</TableCell>
                  <TableCell>
                    {user.role === "admin" ? (
                      <Badge variant="secondary">أدمن</Badge>
                    ) : (
                      <span className="text-muted-foreground">مستخدم</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {user.plan === "premium" ? (
                      <Badge>Premium</Badge>
                    ) : (
                      <span className="text-muted-foreground">Free</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {user.suspendedAt ? (
                      <Badge variant="destructive">معلّق</Badge>
                    ) : (
                      <span className="text-muted-foreground">نشط</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(user.createdAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(user.lastSignedIn)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            صفحة {page + 1} من {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage(p => Math.max(0, p - 1))}
              className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
            >
              <ChevronRight size={14} /> السابق
            </button>
            <button
              type="button"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
            >
              التالي <ChevronLeft size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
