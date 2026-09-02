import { AlertTriangle, CheckCircle2, Database, FileArchive, ListChecks, ServerCog, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthDriver } from "@/lib/auth/constants";
import { isDatabaseUnavailableError } from "@/lib/db/is-database-unavailable-error";
import { prisma } from "@/lib/db/prisma";

type StatusMetric = {
  label: string;
  value: string;
  detail: string;
  icon: typeof Database;
};

async function loadDatabaseMetrics() {
  const [organizations, users, teamMembers, workspaceScopes, products, imageCopyGalleries, files, jobs, exports, wecomSettings] = await Promise.all([
    prisma.organization.count(),
    prisma.user.count(),
    prisma.teamRosterMember.count(),
    prisma.workspaceScope.count(),
    prisma.productRecord.count(),
    prisma.productImageCopyGalleryRecord.count(),
    prisma.fileObject.count(),
    prisma.importJob.count(),
    prisma.exportRecord.count(),
    prisma.weComNotificationSetting.count(),
  ]);

  const incompleteWorkspaceScopes = await prisma.workspaceScope.count({
    where: {
      OR: [{ accountId: "" }, { marketplace: "" }],
    },
  });

  return { organizations, users, teamMembers, workspaceScopes, incompleteWorkspaceScopes, products, imageCopyGalleries, files, jobs, exports, wecomSettings };
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
      databaseError = isDatabaseUnavailableError(error) ? "数据库暂时不可用" : error instanceof Error ? error.message : "数据库状态读取失败";
    }
  }

  const statusMetrics: StatusMetric[] = [
    {
      label: "组织",
      value: metrics ? metrics.organizations.toLocaleString("zh-CN") : "-",
      detail: "组织边界",
      icon: Database,
    },
    {
      label: "账号",
      value: metrics ? metrics.users.toLocaleString("zh-CN") : "-",
      detail: "登录与会话",
      icon: UsersRound,
    },
    {
      label: "团队成员",
      value: metrics ? metrics.teamMembers.toLocaleString("zh-CN") : "-",
      detail: "协作成员",
      icon: UsersRound,
    },
    {
      label: "Workspace",
      value: metrics ? metrics.workspaceScopes.toLocaleString("zh-CN") : "-",
      detail: "组织工作区边界",
      icon: Database,
    },
    {
      label: "待补齐",
      value: metrics ? metrics.incompleteWorkspaceScopes.toLocaleString("zh-CN") : "-",
      detail: "账号 / 站点",
      icon: AlertTriangle,
    },
    {
      label: "商品",
      value: metrics ? metrics.products.toLocaleString("zh-CN") : "-",
      detail: "共享商品资产",
      icon: Database,
    },
    {
      label: "图片文案",
      value: metrics ? metrics.imageCopyGalleries.toLocaleString("zh-CN") : "-",
      detail: "图片与文案草稿",
      icon: FileArchive,
    },
    {
      label: "文件记录",
      value: metrics ? metrics.files.toLocaleString("zh-CN") : "-",
      detail: "原始文件资产",
      icon: FileArchive,
    },
    {
      label: "处理任务",
      value: metrics ? metrics.jobs.toLocaleString("zh-CN") : "-",
      detail: "导入与后台处理",
      icon: ListChecks,
    },
    {
      label: "导出记录",
      value: metrics ? metrics.exports.toLocaleString("zh-CN") : "-",
      detail: "可追溯导出",
      icon: FileArchive,
    },
    {
      label: "WeCom 设置",
      value: metrics ? metrics.wecomSettings.toLocaleString("zh-CN") : "-",
      detail: "通知偏好",
      icon: ServerCog,
    },
  ];

  const healthy = Boolean(metrics && !databaseError);
  const storageIsLocal = storageDriver === "local";
  const queueIsInline = queueDriver === "inline";
  const productionGaps = [
    !hasDatabaseUrl ? "未配置 DATABASE_URL" : "",
    metrics?.incompleteWorkspaceScopes ? `有 ${metrics.incompleteWorkspaceScopes} 个 workspace 缺少账号或站点` : "",
    storageIsLocal ? "文件仍在本地" : "",
    queueIsInline ? "任务仍为同步执行" : "",
  ].filter(Boolean);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-muted text-brand">
            {healthy ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
          </div>
          <div>
            <CardTitle className="text-sm">数据库接入状态</CardTitle>
            <p className="mt-0.5 text-xs font-medium text-muted">用于判断哪些数据已经进入后端共享边界，哪些仍是本地草稿。</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={authDriver === "database" ? "green" : "amber"}>{authDriver === "database" ? "数据库鉴权" : "本地鉴权"}</Badge>
          <Badge tone={storageIsLocal ? "amber" : "green"}>文件：{storageIsLocal ? "本地未共享" : storageDriver.toUpperCase()}</Badge>
          <Badge tone={queueIsInline ? "amber" : "green"}>任务：{queueIsInline ? "同步执行" : queueDriver}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-3">
        {databaseError ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            数据库可配置但当前读取失败：{databaseError}
          </div>
        ) : null}

        {!hasDatabaseUrl ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">
            当前没有配置 DATABASE_URL，系统只能停留在本地兼容模式，无法作为多人共享后端使用。
          </div>
        ) : null}

        {productionGaps.length ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">
            仍需补齐的生产边界：{productionGaps.join("、")}。
          </div>
        ) : null}

        <div className="grid grid-cols-[repeat(auto-fit,128px)] justify-start gap-2">
          {statusMetrics.map((item) => {
            const Icon = item.icon;

            return (
              <div key={item.label} className="rounded-md border border-border bg-surface-muted px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-muted">{item.label}</p>
                  <Icon className="h-4 w-4 text-brand" />
                </div>
                <p className="mt-1 text-xl font-black metric-tabular text-foreground">{item.value}</p>
                <p className="mt-1 truncate text-xs font-medium text-muted">{item.detail}</p>
              </div>
            );
          })}
        </div>

        <div className="grid gap-2 text-xs font-medium leading-4 text-muted lg:grid-cols-3">
          <div className="rounded-md border border-border bg-white p-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="font-bold text-foreground">已接后端边界</p>
              <Badge tone="green">共享</Badge>
            </div>
            <p className="mt-1">账号、组织、团队成员、Workspace、商品、图片文案、文件对象、处理任务、导出记录都在数据库里，适合多人共用。</p>
          </div>
          <div className="rounded-md border border-border bg-white p-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="font-bold text-foreground">仍在本地草稿</p>
              <Badge tone="amber">待迁移</Badge>
            </div>
            <p className="mt-1">PPC 工作区、Listing AI 历史、搜索词合并历史、物流当次处理状态仍依赖浏览器本地存储，属于下一阶段迁移项。</p>
          </div>
          <div className="rounded-md border border-border bg-white p-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="font-bold text-foreground">下一步建议</p>
              <ServerCog className="h-4 w-4 text-brand" />
            </div>
            <p className="mt-1">优先把文件资产迁到对象存储，再把 PPC workspace snapshot 和其他协作草稿迁到组织级表结构。</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
