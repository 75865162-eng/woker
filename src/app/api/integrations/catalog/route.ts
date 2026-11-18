import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { getIntegrationCatalog, getMcpDatasetCatalog } from "@/lib/integration-catalog";
import { getDomainArchitecture, auditDomainArchitecture } from "@/lib/amazon/domain-architecture";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

/** Read-only setup/role-probing catalog. No credential is read or used here. */
export async function GET(request: Request) {
  const permission = await requireApiPermission("settings", "view", request);
  if (!permission.ok) return permission.response;
  // architecture 把「能同步的域 × 落地页 × 自动计划」收敛为单一只读视图；
  // 与 resources（能力/角色/窗口）互补，均为静态架构信息，不代表已有真实数据。
  return NextResponse.json({
    ...getIntegrationCatalog(),
    mcp: getMcpDatasetCatalog(),
    architecture: { rows: getDomainArchitecture(), audit: auditDomainArchitecture() },
  }, { headers });
}
