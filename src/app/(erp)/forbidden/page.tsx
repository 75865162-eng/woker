import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { AppShell } from "@/components/app-shell/app-shell";
import { Card, CardContent } from "@/components/ui/card";

export default function ForbiddenPage() {
  return (
    <AppShell title="Access Denied" subtitle="当前账号没有访问这个页面的权限">
      <Card>
        <CardContent className="flex min-h-[360px] flex-col items-center justify-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-md bg-red-50 text-red-700">
            <ShieldAlert className="h-7 w-7" />
          </div>
          <h2 className="mt-5 text-xl font-black text-foreground">访问被拒绝</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
            当前账号没有勾选这个页面的任何权限。请联系系统管理员在 Accounts 的权限矩阵中开启对应页面。
          </p>
          <Link
            className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-dark"
            href="/accounts"
          >
            返回账号管理
          </Link>
        </CardContent>
      </Card>
    </AppShell>
  );
}
