/**
 * Amazon Marketplace ID → 站点中文名。仅用于展示（列表站点列、站点筛选），
 * 不参与任何业务计算：筛选、同步、对账仍使用原始 Marketplace ID。
 * 未收录的 ID 原样返回，不猜测站点。
 */
export const sellfoxMarketplaceSites: Readonly<Record<string, { code: string; label: string }>> = Object.freeze({
  ATVPDKIKX0DER: { code: "US", label: "美国站" },
  A2EUQ1WTGCTBG2: { code: "CA", label: "加拿大站" },
  A1AM78C64UM0Y8: { code: "MX", label: "墨西哥站" },
  A2Q3Y263D00KWC: { code: "BR", label: "巴西站" },
  A1F83G8C2ARO7P: { code: "UK", label: "英国站" },
  A1PA6795UKMFR9: { code: "DE", label: "德国站" },
  A13V1IB3VIYZZH: { code: "FR", label: "法国站" },
  APJ6JRA9NG5V4: { code: "IT", label: "意大利站" },
  A1RKKUPIHCS9HS: { code: "ES", label: "西班牙站" },
  A1805IZSGTT6HS: { code: "NL", label: "荷兰站" },
  A2NODRKZP88ZB9: { code: "SE", label: "瑞典站" },
  A1C3SOZRARQ6R3: { code: "PL", label: "波兰站" },
  AMEN7PMS3EDWL: { code: "BE", label: "比利时站" },
  A28R8C7NBKEWEA: { code: "IE", label: "爱尔兰站" },
  A1VC38T7YXB528: { code: "JP", label: "日本站" },
  A39IBJ37TRP1C6: { code: "AU", label: "澳大利亚站" },
  A19VAU5U5O7RUS: { code: "SG", label: "新加坡站" },
  A21TJRUUN4KGV: { code: "IN", label: "印度站" },
  A2VIGQ35RCS4UG: { code: "AE", label: "阿联酋站" },
  A17E79C6D8DWNP: { code: "SA", label: "沙特站" },
  A33AVAJ2PDY3EV: { code: "TR", label: "土耳其站" },
});

export function sellfoxSiteLabel(marketplace: unknown): string {
  const id = typeof marketplace === "string" ? marketplace.trim() : "";
  if (!id) return "";
  return sellfoxMarketplaceSites[id]?.label ?? id;
}

/** Marketplace ID → 国家/站点代码（US/CA/DE…），未收录时回退为原始 ID，不猜测。 */
export function siteCodeOf(marketplace: unknown): string {
  const id = typeof marketplace === "string" ? marketplace.trim() : "";
  if (!id) return "";
  return sellfoxMarketplaceSites[id]?.code ?? id;
}

/**
 * 全站统一的「站点-店铺」展示标识，如 `US-aoocy`。
 * 站点部分由 Marketplace ID 映射为国家代码；店铺部分用 ERP 店铺名（displayName）。
 * 仅用于展示：筛选、同步、对账仍使用原始 sellerAccountId / marketplaceId。
 */
export function formatSiteStore(marketplace: unknown, storeName: unknown): string {
  const code = siteCodeOf(marketplace);
  const name = typeof storeName === "string" ? storeName.trim() : "";
  if (!code) return name || "—";
  if (!name) return code;
  return `${code}-${name}`;
}
