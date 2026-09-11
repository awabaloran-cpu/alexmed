"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Loader2, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc-client";

function formatDate(value: string | Date | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("ar", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Local (input-only) date format, e.g. "2026-12-31", for <input type="date">.
function toDateInputValue(value: string | Date | null) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

export default function AdminUserDetailPage() {
  const params = useParams<{ userId: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();

  const detailQuery = trpc.adminUsers.get.useQuery({ userId: params.userId });

  const [planDraft, setPlanDraft] = useState<"free" | "premium" | null>(null);
  const [expiresDraft, setExpiresDraft] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");

  const setPlan = trpc.adminUsers.setPlan.useMutation({
    onSuccess: () => {
      utils.adminUsers.get.invalidate({ userId: params.userId });
      setPlanDraft(null);
      setExpiresDraft(null);
    },
  });
  const setSuspended = trpc.adminUsers.setSuspended.useMutation({
    onSuccess: () => {
      utils.adminUsers.get.invalidate({ userId: params.userId });
    },
  });
  const deleteUser = trpc.adminUsers.delete.useMutation({
    onSuccess: () => {
      router.push("/admin/users");
    },
  });

  if (detailQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">جاري التحميل...</p>;
  }
  if (!detailQuery.data) {
    return (
      <p className="text-sm text-destructive">تعذر العثور على المستخدم.</p>
    );
  }

  const { user, stats } = detailQuery.data;
  const plan = planDraft ?? user.plan;
  const expiresAt = expiresDraft ?? toDateInputValue(user.planExpiresAt);
  const isSuspended = !!user.suspendedAt;
  const planDirty =
    plan !== user.plan || expiresAt !== toDateInputValue(user.planExpiresAt);

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href="/admin/users"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronRight size={14} /> رجوع إلى المستخدمين
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{user.email}</h1>
          <p className="text-sm text-muted-foreground">
            {user.name || "بدون اسم"} · انضم في {formatDate(user.createdAt)}
          </p>
        </div>
        <div className="flex gap-2">
          {user.role === "admin" && <Badge variant="secondary">أدمن</Badge>}
          {isSuspended ? (
            <Badge variant="destructive">معلّق</Badge>
          ) : (
            <Badge variant="outline">نشط</Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">الكتب (كتبي)</p>
            <p className="text-xl font-bold">{stats.bookCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">الملفات (مِرآة)</p>
            <p className="text-xl font-bold">{stats.deckCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">المواد</p>
            <p className="text-xl font-bold">{stats.subjectCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">بطاقات كتبي</p>
            <p className="text-xl font-bold">{stats.bookCardCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">محاولات الاختبار</p>
            <p className="text-xl font-bold">
              {stats.mcqAttemptsTotal}
              {stats.mcqAttemptsTotal > 0 && (
                <span className="ms-1 text-xs font-normal text-muted-foreground">
                  (
                  {Math.round(
                    (stats.mcqAttemptsCorrect / stats.mcqAttemptsTotal) * 100
                  )}
                  % صحيح)
                </span>
              )}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">آخر دخول</p>
            <p className="text-sm font-medium">
              {formatDate(user.lastSignedIn)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">الاشتراك</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            حقل يدوي فقط — لا يوجد نظام دفع حقيقي متصل بعد.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label>الخطة</Label>
              <Select
                value={plan}
                onValueChange={value =>
                  setPlanDraft(value as "free" | "premium")
                }
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="premium">Premium</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>تاريخ الانتهاء (اختياري)</Label>
              <Input
                type="date"
                value={expiresAt}
                onChange={event => setExpiresDraft(event.target.value)}
                className="w-44"
              />
            </div>
            <Button
              disabled={!planDirty || setPlan.isPending}
              onClick={() =>
                setPlan.mutate({
                  userId: params.userId,
                  plan,
                  planExpiresAt: expiresAt
                    ? new Date(expiresAt).toISOString()
                    : null,
                })
              }
            >
              {setPlan.isPending ? "جارٍ الحفظ..." : "حفظ"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">حالة الحساب</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">
                {isSuspended ? "الحساب معلّق حاليًا" : "الحساب نشط"}
              </p>
              <p className="text-xs text-muted-foreground">
                تعليق الحساب يمنع تسجيل الدخول فورًا (Credentials وGoogle) دون
                حذف أي بيانات.
              </p>
            </div>
            <Switch
              checked={!isSuspended}
              disabled={setSuspended.isPending || user.role === "admin"}
              onCheckedChange={checked =>
                setSuspended.mutate({
                  userId: params.userId,
                  suspended: !checked,
                })
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <TriangleAlert size={16} /> منطقة الخطر
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            حذف المستخدم نهائي ولا يمكن التراجع عنه — يحذف كل كتبه وملفاته
            وبطاقاته وسجلاته.
          </p>
          <Button
            variant="destructive"
            disabled={user.role === "admin"}
            onClick={() => setDeleteOpen(true)}
          >
            حذف هذا المستخدم نهائيًا
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف {user.email} نهائيًا؟</AlertDialogTitle>
            <AlertDialogDescription>
              هذا الإجراء نهائي ولا يمكن التراجع عنه. للتأكيد، اكتب البريد
              الإلكتروني للمستخدم بالكامل أدناه.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={confirmEmail}
            onChange={event => setConfirmEmail(event.target.value)}
            placeholder={user.email}
            autoComplete="off"
          />
          {deleteUser.isError && (
            <p className="text-sm text-destructive">تعذر حذف المستخدم.</p>
          )}
          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteOpen(false);
                setConfirmEmail("");
              }}
            >
              إلغاء
            </Button>
            <Button
              variant="destructive"
              disabled={confirmEmail !== user.email || deleteUser.isPending}
              onClick={() => deleteUser.mutate({ userId: params.userId })}
            >
              {deleteUser.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                "احذف نهائيًا"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
