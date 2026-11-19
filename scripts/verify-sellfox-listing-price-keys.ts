/**
 * 价格族字段上线前置核验（只读，不落库、不猜字段）。
 *
 * 依据 docs/field-level-upgrade-guide-5-items.md §1.3 / §7：
 *   在线产品价格族（划线价/listPrice/B2B/优惠价等）在写入映射前，必须先用真实落库
 *   payload 扫描候选键。取不到键就不写映射、不补 0；本脚本只输出证据，不做任何改动。
 *
 * 用法：
 *   node --import ./scripts/runtime/database-bootstrap.mjs \
 *     node_modules/tsx/dist/cli.mjs scripts/verify-sellfox-listing-price-keys.ts \
 *     [--organization-id=ID] [--workspace-id=ID]
 *
 * 输出：
 *   - rowCount=0 时：status=NO_DATA，明确说明无法核验，禁止据此写死映射；
 *   - 有数据时：列出 payload 顶层键中命中价格语义的候选键与各键出现行数，
 *     供人据此填写 narrow-contracts.ts 的白名单映射（仍需抽样确认数值语义）。
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

const PRICE_PATTERN = /price|b2b|busin|list|strike|promo|discount|deal|coupon|market/i;

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.split("=")[1];
  const organizationId = arg("organization-id");
  const workspaceId = arg("workspace-id");
  try {
    const orgFilter = organizationId ? Prisma.sql`AND "organizationId"=${organizationId}` : Prisma.empty;
    const wsFilter = workspaceId ? Prisma.sql`AND "workspaceId"=${workspaceId}` : Prisma.empty;

    const totals = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM "SellfoxListingSnapshot" WHERE 1=1 ${orgFilter} ${wsFilter}`;
    const rowCount = Number(totals[0]?.n ?? 0);

    if (rowCount === 0) {
      console.log(JSON.stringify({
        status: "NO_DATA",
        rowCount: 0,
        message: "无落库 Listing 快照，无法核验价格键；禁止写死映射或补 0。请先同步真实数据后重跑。",
      }, null, 2));
      return;
    }

    const keyRows = await prisma.$queryRaw<Array<{ k: string; n: number }>>`
      SELECT k, count(*)::int AS n
      FROM "SellfoxListingSnapshot"
      CROSS JOIN LATERAL jsonb_object_keys(payload) AS k
      WHERE jsonb_typeof(payload) = 'object' ${orgFilter} ${wsFilter}
      GROUP BY k ORDER BY k`;
    const allKeys = keyRows.map(r => r.k);
    const candidates = keyRows
      .filter(r => PRICE_PATTERN.test(r.k))
      .map(r => ({ key: r.k, rows: Number(r.n) }));

    console.log(JSON.stringify({
      status: candidates.length ? "CANDIDATES_FOUND" : "NO_PRICE_KEYS",
      rowCount,
      totalDistinctKeys: allKeys.length,
      candidates,
      message: candidates.length
        ? "候选键仅供定位；写入前仍须抽样确认每个键的真实数值语义，禁止凭键名猜测。"
        : "payload 无价格语义键；价格族字段不可写入映射，维持 null/—。",
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch(error => { console.error(String(error)); process.exitCode = 1; });
