"use client";

import Link from "next/link";
import {
  BookOpen,
  Crown,
  Layers3,
  ShieldBan,
  UserPlus,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc-client";

function StatCard({
  label,
  value,
  icon: Icon,
  isLoading,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ size?: number }>;
  isLoading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <Icon size={16} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{isLoading ? "—" : value}</div>
      </CardContent>
    </Card>
  );
}

// لوحة التحكم الرئيسية — أرقام حقيقية من getPlatformStatsForAdmin (لا شيء
// وهمي/معلّق هنا)؛ الوظائف الفعلية (بحث/حذف/تعليق/اشتراك) في /admin/users.
export default function AdminOverviewPage() {
  const statsQuery = trpc.adminUsers.stats.useQuery();
  const stats = statsQuery.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">نظرة عامة</h1>
        <p className="text-sm text-muted-foreground">
          أرقام حقيقية عن المنصة، محدّثة الآن.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="إجمالي المستخدمين"
          value={stats?.totalUsers ?? 0}
          icon={Users}
          isLoading={statsQuery.isLoading}
        />
        <StatCard
          label="مستخدمون مميّزون (Premium)"
          value={stats?.premiumUsers ?? 0}
          icon={Crown}
          isLoading={statsQuery.isLoading}
        />
        <StatCard
          label="حسابات معلّقة"
          value={stats?.suspendedUsers ?? 0}
          icon={ShieldBan}
          isLoading={statsQuery.isLoading}
        />
        <StatCard
          label="نشطون اليوم"
          value={stats?.activeToday ?? 0}
          icon={UserPlus}
          isLoading={statsQuery.isLoading}
        />
        <StatCard
          label="تسجيلات جديدة اليوم"
          value={stats?.signupsToday ?? 0}
          icon={UserPlus}
          isLoading={statsQuery.isLoading}
        />
        <StatCard
          label="تسجيلات هذا الأسبوع"
          value={stats?.signupsThisWeek ?? 0}
          icon={UserPlus}
          isLoading={statsQuery.isLoading}
        />
        <StatCard
          label="إجمالي الكتب (كتبي)"
          value={stats?.totalBooks ?? 0}
          icon={BookOpen}
          isLoading={statsQuery.isLoading}
        />
        <StatCard
          label="إجمالي الملفات (مِرآة)"
          value={stats?.totalDecks ?? 0}
          icon={Layers3}
          isLoading={statsQuery.isLoading}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">إدارة المستخدمين</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            البحث عن مستخدم، تعديل الاشتراك، تعليق الحساب، أو حذفه نهائيًا.
          </p>
          <Link
            href="/admin/users"
            className="text-sm font-medium text-primary underline underline-offset-4"
          >
            فتح صفحة المستخدمين ←
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
