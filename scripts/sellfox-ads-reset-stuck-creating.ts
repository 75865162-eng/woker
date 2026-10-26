import { prisma } from "../src/lib/db/prisma";
import {
  parseSellfoxAdsResetStuckCreatingArgs,
  resetSellfoxAdsStuckCreating,
} from "../src/lib/sellfox/ads-reset-stuck-creating";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(`重置卡住的广告报告任务（默认 dry-run；不删行、不调赛狐 API）
必填：--organization-id <id> --workspace-id <id>
可选：--write --report-type <精确代码> --ad-type <sp|sb|sd> --task-id <id>
      --older-than-minutes <非负整数>
仅匹配 status=creating 且 externalTaskId/fileKey 均为空的行；有上游 taskId 的行永不改动。
--write 仅把 status 改为 failed（SellfoxReportTask 无 lastError 列；备注只出现在 CLI JSON）。
部署 879ffe3 后用于解锁 123 上 SD×adTargeringReport 等永久 creating 行，以便同步路径可安全重新提交创建。
逐任务输出 JSON；最终摘要含 selectedTasks/updatedTasks；参数错误退出码 1。`);
    return;
  }
  const input = parseSellfoxAdsResetStuckCreatingArgs(args);
  const summary = await resetSellfoxAdsStuckCreating(input, {
    db: prisma,
    onTask: (task) => console.log(JSON.stringify(task)),
  });
  console.log(JSON.stringify({
    mode: summary.mode,
    organizationId: summary.organizationId,
    workspaceId: summary.workspaceId,
    selectedTasks: summary.selectedTasks,
    updatedTasks: summary.updatedTasks,
    lastError: summary.lastError,
  }));
}

main().catch(() => {
  console.error("卡住任务重置未完成：请检查参数、组织/工作区与数据库配置；未调用上游接口、未删除任务。使用 --help 查看参数。");
  process.exitCode = 1;
}).finally(async () => {
  if (process.env.DATABASE_URL) await prisma.$disconnect();
});
