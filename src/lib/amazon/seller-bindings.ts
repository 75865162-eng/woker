import { prisma } from "@/lib/db/prisma";

export type AmazonSellerBinding = {
  organizationId: string; workspaceId: string; sellerAccountId: string;
  marketplaceId: string; amazonSellerId: string;
  authorizedResources: ("inventory" | "catalog")[];
};

/** Server-managed, explicit mapping. accountKey is never inferred to be a Seller ID. */
export function parseSellerBindings(value: string | undefined): AmazonSellerBinding[] {
  if (!value?.trim()) return [];
  let rows: unknown;
  try { rows = JSON.parse(value); } catch { throw new Error("Amazon 店铺绑定配置不是有效 JSON。"); }
  if (!Array.isArray(rows) || rows.length > 10) throw new Error("Amazon 店铺绑定配置格式无效。");
  const seen = new Set<string>();
  return rows.map((row: unknown) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Amazon 店铺绑定配置格式无效。");
    const item = row as Record<string, unknown>;
    for (const field of ["organizationId", "workspaceId", "sellerAccountId", "marketplaceId", "amazonSellerId"]) {
      if (typeof item[field] !== "string" || !item[field].trim() || item[field].length > 200) throw new Error("Amazon 店铺绑定缺少身份字段。");
    }
    if (!Array.isArray(item.authorizedResources) || item.authorizedResources.some((r) => r !== "inventory" && r !== "catalog")) throw new Error("店铺必须显式列出已授权的同步域。");
    const binding = item as AmazonSellerBinding;
    const key = JSON.stringify([binding.organizationId, binding.workspaceId, binding.sellerAccountId, binding.marketplaceId]);
    if (seen.has(key)) throw new Error("Amazon 店铺绑定重复。");
    seen.add(key);
    return binding;
  });
}

export async function getSellerBindings(organizationId: string, workspaceId: string, resource: "inventory" | "catalog") {
  const bindings = parseSellerBindings(process.env.AMAZON_SP_API_SELLER_BINDINGS).filter((row) => row.organizationId === organizationId && row.workspaceId === workspaceId && row.authorizedResources.includes(resource));
  for (const binding of bindings) {
    const store = await prisma.sellerAccount.findFirst({ where: { id: binding.sellerAccountId, organizationId, workspaceId, status: "active" } });
    if (!store) throw new Error("Amazon 绑定店铺不存在、停用或不属于当前工作区。");
  }
  // A process currently has one credential set: never bind it to multiple seller identities.
  if (new Set(bindings.map((row) => row.amazonSellerId)).size > 1) throw new Error("单组凭证不支持多个 Seller ID；请先接入按店铺解析凭证的服务端密钥库。");
  if (new Set(bindings.map((row) => JSON.stringify([row.amazonSellerId, row.marketplaceId]))).size !== bindings.length) throw new Error("同一 Seller ID + Marketplace 不能重复绑定多个店铺。");
  return bindings;
}
