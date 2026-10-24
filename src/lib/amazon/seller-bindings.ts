import { prisma } from "@/lib/db/prisma";

export type AmazonSellerBinding = {
  organizationId: string;
  workspaceId: string;
  sellerAccountId: string;
  marketplaceId: string;
  amazonSellerId: string;
  authorizedResources: ("inventory" | "catalog")[];
};

export function validateSellerBindingRows(rows: AmazonSellerBinding[]): AmazonSellerBinding[] {
  if (rows.length > 10) throw new Error("Amazon 店铺绑定最多支持 10 行。");
  if (new Set(rows.map((row) => row.amazonSellerId)).size > 1) throw new Error("单组凭证不支持多个 Seller ID。");
  if (new Set(rows.map((row) => JSON.stringify([row.amazonSellerId, row.marketplaceId]))).size !== rows.length) {
    throw new Error("同一 Seller ID + Marketplace 不能重复绑定多个店铺。");
  }
  if (new Set(rows.map((row) => JSON.stringify([row.sellerAccountId, row.marketplaceId]))).size !== rows.length) {
    throw new Error("同一 ERP 店铺和 Marketplace 不能重复绑定。");
  }
  return rows;
}

/** Parses both persisted rows and the legacy AMAZON_SP_API_SELLER_BINDINGS format. */
export function parseSellerBindings(value: string | undefined): AmazonSellerBinding[] {
  if (!value?.trim()) return [];
  let rows: unknown;
  try { rows = JSON.parse(value); } catch { throw new Error("Amazon 店铺绑定配置不是有效 JSON。"); }
  if (!Array.isArray(rows) || rows.length > 10) throw new Error("Amazon 店铺绑定配置格式无效。");
  const parsed = rows.map((row: unknown) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Amazon 店铺绑定配置格式无效。");
    const item = row as Record<string, unknown>;
    for (const field of ["organizationId", "workspaceId", "sellerAccountId", "marketplaceId", "amazonSellerId"]) {
      if (typeof item[field] !== "string" || !item[field].trim() || item[field].length > 200) throw new Error("Amazon 店铺绑定缺少身份字段。");
    }
    if (!Array.isArray(item.authorizedResources) || item.authorizedResources.some((resource) => resource !== "inventory" && resource !== "catalog")) {
      throw new Error("店铺必须显式列出已授权的同步域。");
    }
    const binding = item as AmazonSellerBinding;
    if (new Set(binding.authorizedResources).size !== binding.authorizedResources.length) throw new Error("Amazon 店铺绑定同步域重复。");
    return binding;
  });
  const groups = new Map<string, AmazonSellerBinding[]>();
  for (const row of parsed) {
    const key = JSON.stringify([row.organizationId, row.workspaceId]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const group of groups.values()) validateSellerBindingRows(group);
  return parsed;
}

export function resolveSellerBindingSource(input: {
  databaseRows: AmazonSellerBinding[];
  environmentValue: string | undefined;
  organizationId: string;
  workspaceId: string;
}) {
  if (input.databaseRows.length) return { usingEnvironmentFallback: false, bindings: validateSellerBindingRows(input.databaseRows) };
  const bindings = parseSellerBindings(input.environmentValue).filter((row) => row.organizationId === input.organizationId && row.workspaceId === input.workspaceId);
  return { usingEnvironmentFallback: true, bindings: validateSellerBindingRows(bindings) };
}

export async function getSellerBindings(organizationId: string, workspaceId: string, resource: "inventory" | "catalog") {
  const databaseRows = await prisma.amazonSellerBinding.findMany({
    where: { organizationId, workspaceId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const normalizedDatabaseRows: AmazonSellerBinding[] = databaseRows.map((row) => ({
      ...row,
      authorizedResources: row.authorizedResources.filter((value): value is "inventory" | "catalog" => value === "inventory" || value === "catalog"),
    }));
  const { bindings: effectiveRows } = resolveSellerBindingSource({ databaseRows: normalizedDatabaseRows, environmentValue: process.env.AMAZON_SP_API_SELLER_BINDINGS, organizationId, workspaceId });
  for (const binding of effectiveRows) {
    const store = await prisma.sellerAccount.findFirst({ where: { id: binding.sellerAccountId, organizationId, workspaceId, status: "active" } });
    if (!store) throw new Error("Amazon 绑定店铺不存在、停用或不属于当前工作区。");
  }
  return effectiveRows.filter((row) => row.authorizedResources.includes(resource));
}
