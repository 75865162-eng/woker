import { isSellfoxSortable, type SellfoxSortOrder } from "./sort-columns";
import { isSellfoxDate, sellfoxDateAt } from "@/lib/sellfox/sync-contract";
import { sellfoxBrand, sellfoxBuyBox, sellfoxFulfillment, sellfoxProductTag, type SellfoxBrowseDimension } from "./browse-query";

export const sellfoxDomains = [
  { id: "overview", label: "概览" }, { id: "stores", label: "店铺" }, { id: "inventory", label: "库存" },
  { id: "sales", label: "销量" }, { id: "performance", label: "销售利润" }, { id: "listings", label: "在线商品" },
  { id: "ads", label: "广告" }, { id: "runs", label: "同步日志" },
] as const;
export type SellfoxDomain = (typeof sellfoxDomains)[number]["id"];
export type SellfoxView = { sortBy?: string; sortOrder?: SellfoxSortOrder; adsTab?: "product" | "targeting" | "searchTerm" | "campaign" | "adGroup" | "placement"; domain: SellfoxDomain; from: string; to: string; search: string; site: string; shops: string[]; page: number; allDates: boolean; status?: string; productTag?: string; brand?: string; fulfillment?: "" | "AFN" | "MFN"; buyBox?: "" | "yes" | "no"; dimension?: SellfoxBrowseDimension; metric?: string; hideZero?: boolean; onlySettle?: boolean; currency?: string; adType?: string; quickFilter?: string; pageSize?: number; searchType?: string; exactMatch?: boolean; salesView?: "wide" | "matrix" };
export function sellfoxAdsResource(view: Pick<SellfoxView, "adsTab">) { return view.adsTab === "campaign" ? "ads_campaign" : view.adsTab === "adGroup" ? "ads_ad_group" : view.adsTab === "placement" ? "ads_placement" : view.adsTab === "targeting" ? "ads_targeting" : view.adsTab === "searchTerm" ? "ads_search_term" : "ads_report"; }
export function sellfoxColumnDomain(view: Pick<SellfoxView, "domain" | "adsTab">) { return view.domain === "ads" && view.adsTab && view.adsTab !== "product" ? sellfoxAdsResource(view) : view.domain; }
export const defaultSellfoxView: SellfoxView = { adsTab: "product", domain: "overview", from: "", to: "", search: "", site: "", shops: [], page: 1, allDates: false, status: "", dimension: "asin", metric: "quantity", hideZero: false, currency: "", adType: "", quickFilter: "", pageSize: 20, salesView: "wide" };
export function readSellfoxView(params: URLSearchParams): SellfoxView {
  const domain = params.get("domain"); const page = Number(params.get("page"));
  const sortDomain = domain === "ads" ? sellfoxAdsResource({ adsTab: params.get("adsTab") as SellfoxView["adsTab"] }) : domain ?? "overview";
  return {
    sortBy: isSellfoxSortable(sortDomain, params.get("sortBy") ?? "") ? params.get("sortBy")! : "",
    sortOrder: params.get("sortOrder") === "desc" ? "desc" : "asc",
    adsTab: params.get("adsTab") === "campaign" ? "campaign" : params.get("adsTab") === "adGroup" ? "adGroup" : params.get("adsTab") === "placement" ? "placement" : params.get("adsTab") === "targeting" ? "targeting" : params.get("adsTab") === "searchTerm" ? "searchTerm" : "product",
    domain: sellfoxDomains.some((item) => item.id === domain) ? domain as SellfoxDomain : "overview",
    from: isSellfoxDate(params.get("from")) ? params.get("from")! : "", to: isSellfoxDate(params.get("to")) ? params.get("to")! : "",
    fulfillment: sellfoxFulfillment(params.get("fulfillment")), buyBox: sellfoxBuyBox(params.get("buyBox")), productTag: sellfoxProductTag(params.get("productTag")), brand: sellfoxBrand(params.get("brand")),
    status: ["active", "inActive", "delete", "incomplete"].includes(params.get("status") ?? "") ? params.get("status")! : "",
    dimension: (["asin", "parentAsin", "msku", "sku", "store", "developer", "spu"].includes(params.get("dimension") ?? "") ? params.get("dimension") : "asin") as SellfoxBrowseDimension,
    metric: ["quantity", "orders", "revenue"].includes(params.get("metric") ?? "") ? params.get("metric")! : "quantity",
    onlySettle: params.get("onlySettle") === "1", hideZero: params.get("hideZero") === "1", currency: params.get("currency") ?? (domain === "performance" ? "USD" : ""), adType: ["sp", "sb", "sd"].includes(params.get("adType") ?? "") ? params.get("adType")! : "",
    quickFilter: ["spend", "clicksNoOrders", "spendNoClicks", "noClicks"].includes(params.get("quickFilter") ?? "") ? params.get("quickFilter")! : "",
    salesView: params.get("salesView") === "matrix" ? "matrix" : "wide",
    pageSize: [20, 50, 100, 200].includes(Number(params.get("pageSize"))) ? Number(params.get("pageSize")) : 20,
    searchType: ["asin", "msku", "sku", "parentAsin", "title", "campaignId", "adGroupId", "targetingId", "searchTerm", "placement"].includes(params.get("searchType") ?? "") ? params.get("searchType")! : "", exactMatch: params.get("exactMatch") === "1",
    search: params.get("search") ?? "", site: params.get("site") ?? "", shops: [...new Set(params.getAll("shopExternalId").filter(Boolean))],
    page: Number.isSafeInteger(page) && page >= 1 && page <= 1_000_000 ? page : 1, allDates: params.get("allDates") === "1",
  };
}
/** Freeze only implicit sales/profit dates; explicit and all-history views stay intact. */
export function backfillSellfoxViewDates(view: SellfoxView, dates: unknown): SellfoxView {
  if (!["sales", "performance"].includes(view.domain) || view.allDates || view.from || view.to) return view;
  if (!Array.isArray(dates) || !dates.length || !dates.every(isSellfoxDate)) return view;
  const sorted = [...dates].sort();
  return { ...view, from: sorted[0], to: sorted[sorted.length - 1] };
}
export function sellfoxViewParams(view: SellfoxView, forRequest = false) {
  const params = new URLSearchParams();
  if (view.sortBy) { params.set("sortBy", view.sortBy); params.set("sortOrder", view.sortOrder ?? "asc"); }
  if (!forRequest && view.adsTab && view.adsTab !== "product") params.set("adsTab", view.adsTab);
  if (!forRequest && view.salesView === "matrix") params.set("salesView", "matrix");
  if (!forRequest && view.domain !== "overview") params.set("domain", view.domain);
  if (view.from) params.set("from", view.from); if (view.to) params.set("to", view.to);
  if (view.fulfillment && (!forRequest || ["sales", "performance", "listings"].includes(view.domain))) params.set("fulfillment", view.fulfillment);
  if (view.buyBox && (!forRequest || ["sales", "performance", "listings"].includes(view.domain))) params.set("buyBox", view.buyBox);
  if (view.productTag && (!forRequest || ["sales", "performance", "listings"].includes(view.domain))) params.set("productTag", sellfoxProductTag(view.productTag));
  if (view.brand && (!forRequest || ["sales", "performance", "listings"].includes(view.domain))) params.set("brand", sellfoxBrand(view.brand));
  if (view.status && (!forRequest || view.domain === "listings")) params.set("status", view.status);
  if (forRequest && ["sales", "performance", "listings", "ads"].includes(view.domain)) params.set("layout", "workbench");
  for (const key of ["dimension", "metric", "currency", "adType", "quickFilter"] as const) {
    if (forRequest && key === "currency" && !["sales", "performance"].includes(view.domain)) continue;
    if (forRequest && ["adType", "quickFilter"].includes(key) && view.domain !== "ads") continue;
    if (view[key]) params.set(key, view[key]!);
  }
  if (view.domain === "performance" && !view.currency) params.set("currency", "");
  if (view.domain === "performance" && view.onlySettle) params.set("onlySettle", "1");
  if (view.hideZero) params.set("hideZero", "1");
  if (view.search) params.set("search", view.search);
  if (view.searchType) params.set("searchType", view.searchType);
  if (view.exactMatch) params.set("exactMatch", "1");
  // Run dates refer to start time, not snapshot business date; shop/site do not apply.
  if (!forRequest || view.domain !== "runs") {
    if (view.site) params.set("site", view.site);
    for (const shop of view.shops) params.append("shopExternalId", shop);
  }
  if (view.allDates) params.set("allDates", "1");
  if (forRequest && !view.allDates && !view.from && !view.to && !["overview", "stores", "runs", "listings", "sales", "performance"].includes(view.domain)) params.set("reportDate", sellfoxDateAt(new Date(), view.domain === "inventory" ? 0 : -1));
  if (forRequest || view.page > 1) params.set("page", String(view.page));
  if (forRequest || view.pageSize) params.set("pageSize", String(view.pageSize ?? 20));
  return params;
}

export function sellfoxSortPatch(view: Pick<SellfoxView, "sortBy" | "sortOrder">, key: string): Partial<SellfoxView> {
  return { sortBy: key, sortOrder: view.sortBy === key && view.sortOrder !== "desc" ? "desc" : "asc", page: 1 };
}
