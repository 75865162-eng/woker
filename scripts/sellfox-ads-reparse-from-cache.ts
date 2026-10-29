import { prisma } from "../src/lib/db/prisma";
import { getStorageDriver } from "../src/lib/storage";
import { parseSellfoxAdsReparseArgs, reparseSellfoxAdsReportsFromCache } from "../src/lib/sellfox/ads-reparse-from-cache";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(`缓存广告报告重解析（默认 dry-run；不创建、轮询或下载赛狐任务）
必填：--organization-id <id> --workspace-id <id>
可选：--write --report-type <精确代码> --store-id <id> --shop-external-id <id>
      --ad-type <sp|sb|sd> --task-id <id> --start-date <YYYY-MM-DD> --end-date <YYYY-MM-DD>
默认报告：adTargeringReport + adSearchTermReport；另支持 adProductReport/adCampaignReport/adGroupReport/adSpaceReport。
日期只选完整包含在筛选范围内的任务，每个任务仍替换原始完整窗口。建议先 --task-id 单任务核验。
逐任务输出 JSON；缺文件/解析/写入失败继续其他任务，最终退出码 2；参数或范围错误退出码 1。`);
    return;
  }
  const input = parseSellfoxAdsReparseArgs(args);
  const summary = await reparseSellfoxAdsReportsFromCache(input, { db: prisma, storage: getStorageDriver, onResult: result => console.log(JSON.stringify(result)) });
  console.log(JSON.stringify({ mode: summary.mode, organizationId: summary.organizationId, workspaceId: summary.workspaceId, selectedTasks: summary.selectedTasks, failedTasks: summary.failedTasks }));
  if (summary.failedTasks) process.exitCode = 2;
}

main().catch(() => {
  console.error("缓存重解析未完成：请检查参数、组织/工作区、任务范围、数据库和 storage 配置；未调用上游接口。使用 --help 查看参数。");
  process.exitCode = 1;
}).finally(async () => {
  // 没有 DATABASE_URL 时，--help / 参数校验失败不初始化 Prisma。
  if (process.env.DATABASE_URL) await prisma.$disconnect();
});
