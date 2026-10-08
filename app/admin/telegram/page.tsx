"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc-client";

const LABELS: Record<string, string> = {
  direct: "مباشر (بدون رابط)",
  invite: "دعوة من طالب",
  web_share: "مشاركة من الموقع",
};

const percent = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 100)}%` : "—";

// 📈 Where Telegram students came from (lib/telegram/growth.ts): one row
// per campaign label, with how many arrived, how many had a file processed
// and how many created a full account — plus a maker for new campaign
// links, so every group / post gets its own label.
export default function AdminTelegramPage() {
  const sources = trpc.telegram.sources.useQuery(undefined, { retry: false });
  const status = trpc.telegram.status.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const reported = trpc.sharing.reportedLinks.useQuery(undefined, {
    retry: false,
  });
  const stopLink = trpc.sharing.adminStopLink.useMutation({
    onSuccess: () => utils.sharing.reportedLinks.invalidate(),
  });
  const [label, setLabel] = useState("");
  const [copied, setCopied] = useState(false);

  const clean = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  const botUrl = status.data?.available ? status.data.botUrl : null;
  const link = botUrl && clean ? `${botUrl}?start=src_${clean}` : "";

  const totals = useMemo(() => {
    const rows = sources.data ?? [];
    return {
      arrived: rows.reduce((sum, row) => sum + row.arrived, 0),
      uploaded: rows.reduce((sum, row) => sum + row.uploaded, 0),
      registered: rows.reduce((sum, row) => sum + row.registered, 0),
    };
  }, [sources.data]);

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard access: the link is still on screen to select.
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Telegram — مصادر الطلاب</h1>
        <p className="text-sm text-muted-foreground">
          من أين جاء طلاب البوت، وكم منهم رفع ملفًا وأنشأ حسابًا. أرقام فقط،
          بلا أسماء.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <Label htmlFor="campaign">رابط حملة جديد</Label>
        <p className="text-sm text-muted-foreground">
          اكتب اسمًا قصيرًا بالإنجليزية لكل مجموعة أو منشور (مثال:{" "}
          <bdi dir="ltr">batch6</bdi>) وانشر الرابط الناتج هناك فقط، لتعرف ما
          الذي جاء منه.
        </p>
        <div className="flex flex-wrap gap-2">
          <Input
            id="campaign"
            dir="ltr"
            className="max-w-xs"
            value={label}
            onChange={event => setLabel(event.target.value)}
            placeholder="batch6"
          />
          <Button type="button" disabled={!link} onClick={copy}>
            {copied ? "تم النسخ" : "نسخ الرابط"}
          </Button>
        </div>
        {link ? (
          <p className="break-all text-sm" dir="ltr">
            {link}
          </p>
        ) : !botUrl ? (
          <p className="text-sm text-muted-foreground">
            بوابة Telegram غير مفعّلة على هذا الخادم.
          </p>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>المصدر</TableHead>
              <TableHead>وصلوا</TableHead>
              <TableHead>رفعوا ملفًا</TableHead>
              <TableHead>أنشأوا حسابًا</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(sources.data ?? []).map(row => (
              <TableRow key={row.source}>
                <TableCell>
                  {LABELS[row.source] ?? <bdi dir="ltr">{row.source}</bdi>}
                </TableCell>
                <TableCell>{row.arrived}</TableCell>
                <TableCell>
                  {row.uploaded}{" "}
                  <span className="text-xs text-muted-foreground">
                    {percent(row.uploaded, row.arrived)}
                  </span>
                </TableCell>
                <TableCell>
                  {row.registered}{" "}
                  <span className="text-xs text-muted-foreground">
                    {percent(row.registered, row.arrived)}
                  </span>
                </TableCell>
              </TableRow>
            ))}
            {sources.data?.length ? (
              <TableRow>
                <TableCell className="font-medium">المجموع</TableCell>
                <TableCell>{totals.arrived}</TableCell>
                <TableCell>{totals.uploaded}</TableCell>
                <TableCell>{totals.registered}</TableCell>
              </TableRow>
            ) : null}
            {sources.data && !sources.data.length ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center text-sm text-muted-foreground"
                >
                  لا يوجد طلاب من Telegram بعد.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      {/* 🔗 Files shared by link that students reported
          (lib/share-links.ts). Stopping one withdraws everyone who joined
          and cannot be undone by the owner. */}
      <div className="space-y-2">
        <h2 className="text-lg font-bold">بلاغات الملفات المشارَكة</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الملف</TableHead>
                <TableHead>صاحبه</TableHead>
                <TableHead>انضموا</TableHead>
                <TableHead>بلاغات</TableHead>
                <TableHead>إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(reported.data ?? []).map(row => (
                <TableRow key={row.linkId}>
                  <TableCell>
                    <bdi>{row.title}</bdi>
                    <div className="text-xs text-muted-foreground">
                      {row.sourceType === "question_file" ? "ملف أسئلة" : "كتاب"}
                    </div>
                  </TableCell>
                  <TableCell>{row.ownerName ?? "—"}</TableCell>
                  <TableCell>{row.joinCount}</TableCell>
                  <TableCell>{row.reportCount}</TableCell>
                  <TableCell>
                    {row.revokedAt ? (
                      <span className="text-sm text-muted-foreground">
                        {row.revokedBy === "admin"
                          ? "أوقفته الإدارة"
                          : "أوقفه صاحبه"}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="rounded-md border border-destructive px-2 py-1 text-sm text-destructive"
                        disabled={stopLink.isPending}
                        onClick={() => stopLink.mutate({ linkId: row.linkId })}
                      >
                        إيقاف المشاركة
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {reported.data && !reported.data.length ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-sm text-muted-foreground"
                  >
                    لا توجد بلاغات.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </div>

      {sources.error ? (
        <p className="text-sm text-destructive" role="alert">
          {sources.error.message}
        </p>
      ) : null}
    </div>
  );
}
