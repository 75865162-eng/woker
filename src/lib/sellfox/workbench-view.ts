import { isSellfoxDate, sellfoxDateAt } from "@/lib/sellfox/sync-contract";

export const sellfoxDomains = [
  { id: "overview", label: "概览" }, { id: "stores", label: "店铺" }, { id: "inventory", label: "库存" },
  { id: "sales", label: "销量" }, { id: "performance", label: "产品表现" }, { id: "listings", label: "在线 Listing" },
  { id: "ads", label: "广告" }, { id: "runs", label: "同步日志" },
] as const;
export type SellfoxDomain = (typeof sellfoxDomains)[number]["id"];
export type SellfoxView = { domain: SellfoxDomain; from: string; to: string; search: string; site: string; shops: string[]; page: number; allDates: boolean };
export const defaultSellfoxView: SellfoxView = { domain: "overview", from: "", to: "", search: "", site: "", shops: [], page: 1, allDates: false };
export function readSellfoxView(params: URLSearchParams): SellfoxView {
  const domain = params.get("domain"); const page = Number(params.get("page"));
  return {
    domain: sellfoxDomains.some((item) => item.id === domain) ? domain as SellfoxDomain : "overview",
    from: isSellfoxDate(params.get("from")) ? params.get("from")! : "", to: isSellfoxDate(params.get("to")) ? params.get("to")! : "",
    search: params.get("search") ?? "", site: params.get("site") ?? "", shops: [...new Set(params.getAll("shopExternalId").filter(Boolean))],
    page: Number.isSafeInteger(page) && page >= 1 && page <= 1_000_000 ? page : 1, allDates: params.get("allDates") === "1",
  };
}
export function sellfoxViewParams(view: SellfoxView, forRequest = false) {
  const params = new URLSearchParams();
  if (!forRequest && view.domain !== "overview") params.set("domain", view.domain);
  if (view.from) params.set("from", view.from); if (view.to) params.set("to", view.to);
  if (view.search) params.set("search", view.search);
  // Run dates refer to start time, not snapshot business date; shop/site do not apply.
  if (!forRequest || view.domain !== "runs") {
    if (view.site) params.set("site", view.site);
    for (const shop of view.shops) params.append("shopExternalId", shop);
  }
  if (view.allDates) params.set("allDates", "1");
  if (forRequest && !view.allDates && !view.from && !view.to && !["overview", "stores", "runs", "listings"].includes(view.domain)) params.set("reportDate", sellfoxDateAt(new Date(), view.domain === "inventory" ? 0 : -1));
  if (forRequest || view.page > 1) params.set("page", String(view.page));
  if (forRequest) params.set("pageSize", "50");
  return params;
}
