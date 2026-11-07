import type { Locale } from "./tx";
import { tx } from "./tx";

export const TAGS: Record<string, { zh: string; en: string }> = {
  reports: { zh: "报表与分析", en: "Reports and analysis" },
  ads: { zh: "广告", en: "Ads" },
  market: { zh: "市场", en: "Market" },
  listing: { zh: "Listing", en: "Listing" },
  profit: { zh: "利润", en: "Profit" },
  restock: { zh: "补货", en: "Restock" },
  data: { zh: "数据", en: "Data" },
  returns: { zh: "退货", en: "Returns" },
  keywords: { zh: "关键词", en: "Keywords" },
  compliance: { zh: "合规", en: "Compliance" },
  orders: { zh: "订单", en: "Orders" },
  featured: { zh: "精选", en: "Featured" },
};

export function tagLabel(locale: Locale, id: string) {
  const row = TAGS[id];
  if (!row) return id;
  return tx(locale, row.zh, row.en);
}
