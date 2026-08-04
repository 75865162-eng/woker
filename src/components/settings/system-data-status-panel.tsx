import { AlertTriangle, CheckCircle2, Database, FileArchive, ListChecks, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthDriver } from "@/lib/auth/constants";
import { prisma } from "@/lib/db/prisma";

type StatusMetric = {
  label: string;
  value: string;
  detail: string;
  icon: typeof Database;
};

async function loadDatabaseMetrics() {
  const [organizations, users, teamMembers, products, imageCopyGalleries, files, jobs, exports] = await Promise.all([
    prisma.organization.count(),
    prisma.user.count(),
    prisma.teamRosterMember.count(),
    prisma.productRecord.count(),
    prisma.productImageCopyGalleryRecord.count(),
    prisma.fileObject.count(),
    prisma.importJob.count(),
    prisma.exportRecord.count(),
  ]);

  return { organizations, users, teamMembers, products, imageCopyGalleries, files, jobs, exports };
}

export async function SystemDataStatusPanel() {
  const authDriver = getAuthDriver();
  const storageDriver = process.env.STORAGE_DRIVER || "local";
  const queueDriver = process.env.QUEUE_DRIVER || "inline";
  const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
  let metrics: Awaited<ReturnType<typeof loadDatabaseMetrics>> | null = null;
  let databaseError = "";

  if (hasDatabaseUrl) {
    try {
      metrics = await loadDatabaseMetrics();
    } catch (error) {
      databaseError = error instanceof Error ? error.message : "数据库状态读取失败";
    }
  }

  const statusMetrics: StatusMetric[] = [
    {
      label: "组织",
      value: metrics ? metrics.organizations.toLocaleString("zh-CN") : "-",
      detail: "Organization",
      icon: Database,
    },
    {
      label: "用户",
      value: metrics ? metrics.users.toLocaleString("zh-CN") : "-",
      detail: "User / Session",
      icon: UsersRound,
    },
    {
      label: "团队成员",
      value: metrics ? metrics.teamMembers.toLocaleString("zh-CN") : "-",
      detail: "TeamRosterMember",
      icon: UsersRound,
    },
    {
      label: "商品",
      value: metrics ? metrics.products.toLocaleString("zh-CN") : "-",
      detail: "ProductRecord",
      icon: Database,
    },
    {
      label: "图片文案",
      value: metrics ? metrics.imageCopyGalleries.toLocaleString("zh-CN") : "-",
      detail: "ImageCopyGallery",
      icon: FileArchive,
    },
    {
      label: "文件记录",
      value: metrics ? metrics.files.toLocaleString("zh-CN") : "-",
      detail: "FileObject",
      icon: FileArchive,
    },
    {
      label: "处理任务",
      value: metrics ? metrics.jobs.toLocaleString("zh-CN") : "-",
      detail: "ImportJob",
      icon: ListChecks,
    },
    {
      label: "导出记录",
      value: metrics ? metrics.exports.toLocaleString("zh-CN") : "-",
      detail: "ExportRecord",
      icon: FileArchive,
    },
  ];

  const healthy = Boolean(metrics && !databaseError);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-surface-muted text-brand">
            {healthy ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5 text-amber-600" />}
          </div>
          <div>
            <CardTitle>数据库接入状态</CardTitle>
            <p className="mt-1 text-xs font-medium text-muted">用于判断哪些页面已经具备多人共享的数据边界。</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={authDriver === "database" ? "green" : "amber"}>{authDriver === "database" ? "数据库鉴权" : "本地鉴权"}</Badge>
          <Badge tone={storageDriver === "local" ? "amber" : "green"}>文件：{storageDriver === "local" ? "本地" : storageDriver.toUpperCase()}</Badge>
          <Badge tone={queueDriver === "inline" ? "amber" : "green"}>任务：{queueDriver === "inline" ? "同步处理" : queueDriver}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {databaseError ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            数据库可配置但当前读取失败：{databaseError}
          </div>
        ) : null}

        {!hasDatabaseUrl ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">
            当前没有配置 DATABASE_URL，系统只能使用本地兼容模式。
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
          {statusMetrics.map((item) => {
            const Icon = item.icon;

            return (
              <div key={item.label} className="rounded-md border border-border bg-surface-muted px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-muted">{item.label}</p>
                  <Icon className="h-4 w-4 text-brand" />
                </div>
                <p className="mt-2 text-2xl font-black metric-tabular text-foreground">{item.value}</p>
                <p className="mt-1 truncate text-xs font-medium text-muted">{item.detail}</p>
              </div>
            );
          })}
        </div>

        <div className="grid gap-3 text-xs font-medium leading-5 text-muted lg:grid-cols-3">
          <div className="rounded-md border border-border bg-white p-3">
            <p className="font-bold text-foreground">已接后端边界</p>
            <p className="mt-1">账号、组织、团队成员、商品清单、图片文案、文件对象、处理任务、导出记录。</p>
          </div>
          <div className="rounded-md border border-border bg-white p-3">
            <p className="font-bold text-foreground">仍在本地草稿</p>
            <p className="mt-1">PPC 工作区、Listing AI 历史、搜索词合并历史、物流当次处理状态。</p>
          </div>
          <div className="rounded-md border border-border bg-white p-3">
            <p className="font-bold text-foreground">下一步建议</p>
            <p className="mt-1">下一步把商品试算草稿绑定 SKU，再迁 PPC workspace snapshot。</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
