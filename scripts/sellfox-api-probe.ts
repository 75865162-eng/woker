/**
 * Probe Sellfox read endpoints to record which ones this App ID may actually call.
 *
 * Usage:
 *   node --import ./scripts/runtime/database-bootstrap.mjs node_modules/tsx/dist/cli.mjs \
 *     scripts/sellfox-api-probe.ts --organization-id=ID --workspace-id=default
 *
 * One request per endpoint, serialized by the shared global rate limiter.
 * Output: endpoint -> ok / business code, so the integration plan can mark
 * "needs Sellfox API permission" instead of guessing.
 */
import { prisma } from "@/lib/db/prisma";
import { sellfoxPost, SellfoxRequestError } from "@/lib/sellfox/client";
import { withSellfoxCredentialScope } from "@/lib/sellfox/credential-context";

const probes: { label: string; path: string; body: Record<string, unknown> }[] = [
  { label: "店铺列表", path: "/api/shop/pageList.json", body: { pageNo: "1", pageSize: "1" } },
  { label: "FBA库存明细", path: "/api/inventory/fba/pageList.json", body: { pageNo: "1", pageSize: "1" } },
  { label: "FBA退货报告", path: "/api/order/api/report/fbaReturn/pageList.json", body: { pageNo: "1", pageSize: "1" } },
  { label: "FBM订单", path: "/api/packageShip/getPackagePage.json", body: { pageNo: "1", pageSize: "1" } },
  { label: "利润报表-店铺(月度)", path: "/api/financial/v2/monthProfit/shop.json", body: { pageNo: "1", pageSize: "1" } },
  { label: "利润报表-店铺", path: "/api/financial/shop.json", body: { pageNo: "1", pageSize: "1" } },
  { label: "FBA仓库明细", path: "/api/finance/fbaStockDetail/pageList.json", body: { pageNo: "1", pageSize: "1" } },
  { label: "Amazon报告任务", path: "/api/report/center/pageList.json", body: { pageNo: "1", pageSize: "1" } },
  { label: "SP广告活动(管理数据)", path: "/api/cpc/manageData/spCampaign.json", body: { pageNo: "1", pageSize: "1" } },
  { label: "ABA搜索词", path: "/api/cpc/searchTerms/pageList.json", body: { pageNo: "1", pageSize: "1" } },
  { label: "其他入库单列表", path: "/api/warehouseInOut/inRecords.json", body: { pageNo: "1", pageSize: "1" } },
];

function parseArgs(argv: string[]) {
  const out = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) out.set(match[1], match[2]);
  }
  return out;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const organizationId = options.get("organization-id");
  const workspaceId = options.get("workspace-id") ?? "default";
  if (!organizationId) throw new Error("必须指定 --organization-id。");
  const results: { label: string; path: string; ok: boolean; code?: number; message: string }[] = [];
  await withSellfoxCredentialScope({ organizationId, workspaceId }, async () => {
    for (const probe of probes) {
      try {
        const data = await sellfoxPost<unknown>(probe.path, probe.body);
        const rows = (() => {
          if (Array.isArray(data)) return data.length;
          const record = data as { rows?: unknown; totalSize?: unknown } | null;
          return Array.isArray(record?.rows) ? record.rows.length : null;
        })();
        results.push({ label: probe.label, path: probe.path, ok: true, message: `可调用（示例行数 ${rows ?? "—"}）` });
      } catch (error) {
        const request = error as SellfoxRequestError;
        results.push({ label: probe.label, path: probe.path, ok: false, code: request.code, message: request.message });
      }
    }
  });
  console.log(JSON.stringify(results, null, 1));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "unknown" }));
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
