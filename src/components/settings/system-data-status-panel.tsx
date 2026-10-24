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
  const [organizations, users, teamMembers, workspaceScopes, products, files, jobs, exports, wecomSettings] = await Promise.all([
    prisma.organization.count(),
    prisma.user.count(),
    prisma.teamRosterMember.count(),
    prisma.workspaceScope.count(),
    prisma.productRecord.count(),
    prisma.fileObject.count(),
    prisma.importJob.count(),
    prisma.exportRecord.count(),
    prisma.weComNotificationSetting.count(),
  ]);

  return { organizations, users, teamMembers, workspaceScopes, products, files, jobs, exports, wecomSettings };
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
      label: "商品",
      value: metrics ? metrics.products.toLocaleString("zh-CN") : "-",
      detail: "共享商品资产",
      icon: Database,
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
            <CardTitle className="text-sm">系统状态</CardTitle>
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

        <details>
        <summary className="cursor-pointer text-sm font-semibold text-muted">数据计量</summary>
        <div className="mt-2 grid grid-cols-[repeat(auto-fit,128px)] justify-start gap-2">
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
        </details>
      </CardContent>
    </Card>
  );
}
