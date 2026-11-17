import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { getIntegrationCatalog, getMcpDatasetCatalog } from "@/lib/integration-catalog";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

/** Read-only setup/role-probing catalog. No credential is read or used here. */
export async function GET(request: Request) {
  const permission = await requireApiPermission("settings", "view", request);
  if (!permission.ok) return permission.response;
  return NextResponse.json({ ...getIntegrationCatalog(), mcp: getMcpDatasetCatalog() }, { headers });
}
