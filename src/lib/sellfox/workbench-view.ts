import { isSellfoxSortable, type SellfoxSortOrder } from "./sort-columns";
import { isSellfoxDate, sellfoxDateAt } from "@/lib/sellfox/sync-contract";
import { sellfoxBrand, sellfoxBsrCategory, sellfoxBuyBox, sellfoxDxmPublishState, sellfoxFulfillment, sellfoxProductTag, sellfoxSalesperson, type SellfoxBrowseDimension } from "./browse-query";

export const sellfoxDomains = [
  { id: "overview", label: "概览" }, { id: "stores", label: "店铺" }, { id: "inventory", label: "库存" },
  { id: "sales", label: "销量" }, { id: "performance", label: "销售利润" }, { id: "listings", label: "在线商品" },
  { id: "ads", label: "广告" }, { id: "runs", label: "同步日志" },
] as const;
export type SellfoxDomain = (typeof sellfoxDomains)[number]["id"];
export type SellfoxView = { sortBy?: string; sortOrder?: SellfoxSortOrder; adsTab?: "product" | "targeting" | "searchTerm" | "campaign" | "adGroup" | "placement"; domain: SellfoxDomain; firstSaleFrom?: string; firstSaleTo?: string; totalInventoryMin?: string; totalInventoryMax?: string; ratingMin?: string; ratingMax?: string; ratingCountMin?: string; ratingCountMax?: string; costMin?: string; costMax?: string; adSalesMin?: string; adSalesMax?: string; impressionsMin?: string; impressionsMax?: string; clicksMin?: string; clicksMax?: string; adOrdersMin?: string; adOrdersMax?: string; bsrRankMin?: string; bsrRankMax?: string; fulfillableMin?: string; fulfillableMax?: string; sales7Min?: string; sales7Max?: string; sales14Min?: string; sales14Max?: string; sales30Min?: string; sales30Max?: string; priceMin?: string; priceMax?: string; revenue7Min?: string; revenue7Max?: string; revenue14Min?: string; revenue14Max?: string; listingQuantityMin?: string; listingQuantityMax?: string; reservedQtyMin?: string; reservedQtyMax?: string; unsellableMin?: string; unsellableMax?: string; warehousingMin?: string; warehousingMax?: string; from: string; to: string; search: string; site: string; shops: string[]; page: number; allDates: boolean; status?: string; productTag?: string; brand?: string; dxmPublishState?: string; bsrCategory?: string; salesperson?: string; fulfillment?: "" | "AFN" | "MFN"; buyBox?: "" | "yes" | "no"; dimension?: SellfoxBrowseDimension; metric?: string; hideZero?: boolean; onlySettle?: boolean; currency?: string; adType?: string; quickFilter?: string; pageSize?: number; searchType?: string; exactMatch?: boolean; salesView?: "wide" | "matrix" };
export function sellfoxAdsResource(view: Pick<SellfoxView, "adsTab">) { return view.adsTab === "campaign" ? "ads_campaign" : view.adsTab === "adGroup" ? "ads_ad_group" : view.adsTab === "placement" ? "ads_placement" : view.adsTab === "targeting" ? "ads_targeting" : view.adsTab === "searchTerm" ? "ads_search_term" : "ads_report"; }
export function sellfoxColumnDomain(view: Pick<SellfoxView, "domain" | "adsTab">) { return view.domain === "ads" && view.adsTab && view.adsTab !== "product" ? sellfoxAdsResource(view) : view.domain; }
export const defaultSellfoxView: SellfoxView = { adsTab: "product", domain: "overview", firstSaleFrom: "", firstSaleTo: "", totalInventoryMin: "", totalInventoryMax: "", ratingMin: "", ratingMax: "", ratingCountMin: "", ratingCountMax: "", costMin: "", costMax: "", adSalesMin: "", adSalesMax: "", impressionsMin: "", impressionsMax: "", clicksMin: "", clicksMax: "", adOrdersMin: "", adOrdersMax: "", bsrRankMin: "", bsrRankMax: "", fulfillableMin: "", fulfillableMax: "", sales7Min: "", sales7Max: "", sales14Min: "", sales14Max: "", sales30Min: "", sales30Max: "", priceMin: "", priceMax: "", revenue7Min: "", revenue7Max: "", revenue14Min: "", revenue14Max: "", listingQuantityMin: "", listingQuantityMax: "", reservedQtyMin: "", reservedQtyMax: "", unsellableMin: "", unsellableMax: "", warehousingMin: "", warehousingMax: "", from: "", to: "", search: "", site: "", shops: [], page: 1, allDates: false, status: "", dimension: "asin", metric: "quantity", hideZero: false, currency: "", adType: "", quickFilter: "", pageSize: 20, salesView: "wide" };
function sellfoxSafeNumberText(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return "";
  const number = Number(trimmed);
  return Number.isFinite(number) ? String(number) : "";
}
function sellfoxSafeIntText(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!/^-?\d+$/.test(trimmed)) return "";
  const number = Number(trimmed);
  return Number.isSafeInteger(number) ? String(number) : "";
}
export function readSellfoxView(params: URLSearchParams): SellfoxView {
  const domain = params.get("domain"); const page = Number(params.get("page"));
  const sortDomain = domain === "ads" ? sellfoxAdsResource({ adsTab: params.get("adsTab") as SellfoxView["adsTab"] }) : domain ?? "overview";
  return {
    sortBy: isSellfoxSortable(sortDomain, params.get("sortBy") ?? "") ? params.get("sortBy")! : "",
    sortOrder: params.get("sortOrder") === "desc" ? "desc" : "asc",
    adsTab: params.get("adsTab") === "campaign" ? "campaign" : params.get("adsTab") === "adGroup" ? "adGroup" : params.get("adsTab") === "placement" ? "placement" : params.get("adsTab") === "targeting" ? "targeting" : params.get("adsTab") === "searchTerm" ? "searchTerm" : "product",
    domain: sellfoxDomains.some((item) => item.id === domain) ? domain as SellfoxDomain : "overview",
    from: isSellfoxDate(params.get("from")) ? params.get("from")! : "", to: isSellfoxDate(params.get("to")) ? params.get("to")! : "",
    firstSaleFrom: isSellfoxDate(params.get("firstSaleFrom")) ? params.get("firstSaleFrom")! : "", firstSaleTo: isSellfoxDate(params.get("firstSaleTo")) ? params.get("firstSaleTo")! : "",
    totalInventoryMin: sellfoxSafeIntText(params.get("totalInventoryMin")), totalInventoryMax: sellfoxSafeIntText(params.get("totalInventoryMax")),
    ratingMin: sellfoxSafeNumberText(params.get("ratingMin")), ratingMax: sellfoxSafeNumberText(params.get("ratingMax")),
    costMin: sellfoxSafeNumberText(params.get("costMin")), costMax: sellfoxSafeNumberText(params.get("costMax")),
    adSalesMin: sellfoxSafeNumberText(params.get("adSalesMin")), adSalesMax: sellfoxSafeNumberText(params.get("adSalesMax")),
    impressionsMin: sellfoxSafeIntText(params.get("impressionsMin")), impressionsMax: sellfoxSafeIntText(params.get("impressionsMax")),
    clicksMin: sellfoxSafeIntText(params.get("clicksMin")), clicksMax: sellfoxSafeIntText(params.get("clicksMax")),
    adOrdersMin: sellfoxSafeIntText(params.get("adOrdersMin")), adOrdersMax: sellfoxSafeIntText(params.get("adOrdersMax")),
    ratingCountMin: sellfoxSafeIntText(params.get("ratingCountMin")), ratingCountMax: sellfoxSafeIntText(params.get("ratingCountMax")),
    bsrRankMin: sellfoxSafeIntText(params.get("bsrRankMin")), bsrRankMax: sellfoxSafeIntText(params.get("bsrRankMax")),
    fulfillableMin: sellfoxSafeIntText(params.get("fulfillableMin")), fulfillableMax: sellfoxSafeIntText(params.get("fulfillableMax")),
    sales7Min: sellfoxSafeIntText(params.get("sales7Min")), sales7Max: sellfoxSafeIntText(params.get("sales7Max")),
    sales14Min: sellfoxSafeIntText(params.get("sales14Min")), sales14Max: sellfoxSafeIntText(params.get("sales14Max")),
    sales30Min: sellfoxSafeIntText(params.get("sales30Min")), sales30Max: sellfoxSafeIntText(params.get("sales30Max")),
    priceMin: sellfoxSafeNumberText(params.get("priceMin")), priceMax: sellfoxSafeNumberText(params.get("priceMax")),
    revenue7Min: sellfoxSafeNumberText(params.get("revenue7Min")), revenue7Max: sellfoxSafeNumberText(params.get("revenue7Max")),
    revenue14Min: sellfoxSafeNumberText(params.get("revenue14Min")), revenue14Max: sellfoxSafeNumberText(params.get("revenue14Max")),
    listingQuantityMin: sellfoxSafeNumberText(params.get("listingQuantityMin")), listingQuantityMax: sellfoxSafeNumberText(params.get("listingQuantityMax")),
    reservedQtyMin: sellfoxSafeNumberText(params.get("reservedQtyMin")), reservedQtyMax: sellfoxSafeNumberText(params.get("reservedQtyMax")),
    unsellableMin: sellfoxSafeNumberText(params.get("unsellableMin")), unsellableMax: sellfoxSafeNumberText(params.get("unsellableMax")),
    warehousingMin: sellfoxSafeNumberText(params.get("warehousingMin")), warehousingMax: sellfoxSafeNumberText(params.get("warehousingMax")),
    fulfillment: sellfoxFulfillment(params.get("fulfillment")), buyBox: sellfoxBuyBox(params.get("buyBox")), productTag: sellfoxProductTag(params.get("productTag")), brand: sellfoxBrand(params.get("brand")), dxmPublishState: sellfoxDxmPublishState(params.get("dxmPublishState")), bsrCategory: sellfoxBsrCategory(params.get("bsrCategory")), salesperson: sellfoxSalesperson(params.get("salesperson")),
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
  if (view.fulfillment && (!forRequest || ["sales", "performance", "listings", "ads"].includes(view.domain))) params.set("fulfillment", view.fulfillment);
  if (view.buyBox && (!forRequest || ["sales", "performance", "listings", "ads"].includes(view.domain))) params.set("buyBox", view.buyBox);
  if (view.productTag && (!forRequest || ["sales", "performance", "listings", "ads"].includes(view.domain))) params.set("productTag", sellfoxProductTag(view.productTag));
  if (view.brand && (!forRequest || ["sales", "performance", "listings", "ads"].includes(view.domain))) params.set("brand", sellfoxBrand(view.brand));
  if (!forRequest || view.domain === "ads") {
    if (view.ratingMin) params.set("ratingMin", view.ratingMin);
    if (view.ratingMax) params.set("ratingMax", view.ratingMax);
    if (view.ratingCountMin) params.set("ratingCountMin", view.ratingCountMin);
    if (view.ratingCountMax) params.set("ratingCountMax", view.ratingCountMax);
    if (view.costMin) params.set("costMin", view.costMin);
    if (view.costMax) params.set("costMax", view.costMax);
    if (view.adSalesMin) params.set("adSalesMin", view.adSalesMin);
    if (view.adSalesMax) params.set("adSalesMax", view.adSalesMax);
    if (view.impressionsMin) params.set("impressionsMin", view.impressionsMin);
    if (view.impressionsMax) params.set("impressionsMax", view.impressionsMax);
    if (view.clicksMin) params.set("clicksMin", view.clicksMin);
    if (view.clicksMax) params.set("clicksMax", view.clicksMax);
    if (view.adOrdersMin) params.set("adOrdersMin", view.adOrdersMin);
    if (view.adOrdersMax) params.set("adOrdersMax", view.adOrdersMax);
  }
  if (!forRequest || view.domain === "listings") {
    if (view.firstSaleFrom) params.set("firstSaleFrom", view.firstSaleFrom);
    if (view.firstSaleTo) params.set("firstSaleTo", view.firstSaleTo);
    if (view.totalInventoryMin) params.set("totalInventoryMin", view.totalInventoryMin);
    if (view.totalInventoryMax) params.set("totalInventoryMax", view.totalInventoryMax);
    if (view.bsrRankMin) params.set("bsrRankMin", view.bsrRankMin);
    if (view.bsrRankMax) params.set("bsrRankMax", view.bsrRankMax);
    if (view.fulfillableMin) params.set("fulfillableMin", view.fulfillableMin);
    if (view.fulfillableMax) params.set("fulfillableMax", view.fulfillableMax);
    if (view.sales7Min) params.set("sales7Min", view.sales7Min);
    if (view.sales7Max) params.set("sales7Max", view.sales7Max);
    if (view.sales14Min) params.set("sales14Min", view.sales14Min);
    if (view.sales14Max) params.set("sales14Max", view.sales14Max);
    if (view.sales30Min) params.set("sales30Min", view.sales30Min);
    if (view.sales30Max) params.set("sales30Max", view.sales30Max);
    if (view.priceMin) params.set("priceMin", view.priceMin);
    if (view.priceMax) params.set("priceMax", view.priceMax);
    if (view.revenue7Min) params.set("revenue7Min", view.revenue7Min);
    if (view.revenue7Max) params.set("revenue7Max", view.revenue7Max);
    if (view.revenue14Min) params.set("revenue14Min", view.revenue14Min);
    if (view.revenue14Max) params.set("revenue14Max", view.revenue14Max);
    if (view.listingQuantityMin) params.set("listingQuantityMin", view.listingQuantityMin);
    if (view.listingQuantityMax) params.set("listingQuantityMax", view.listingQuantityMax);
    if (view.reservedQtyMin) params.set("reservedQtyMin", view.reservedQtyMin);
    if (view.reservedQtyMax) params.set("reservedQtyMax", view.reservedQtyMax);
    if (view.unsellableMin) params.set("unsellableMin", view.unsellableMin);
    if (view.unsellableMax) params.set("unsellableMax", view.unsellableMax);
    if (view.warehousingMin) params.set("warehousingMin", view.warehousingMin);
    if (view.warehousingMax) params.set("warehousingMax", view.warehousingMax);
  }
  const dxmPublishState = sellfoxDxmPublishState(view.dxmPublishState);
  if (dxmPublishState && (!forRequest || view.domain === "listings")) params.set("dxmPublishState", dxmPublishState);
  const bsrCategory = sellfoxBsrCategory(view.bsrCategory);
  if (bsrCategory && (!forRequest || view.domain === "listings")) params.set("bsrCategory", bsrCategory);
  if (view.salesperson && (!forRequest || view.domain === "performance")) params.set("salesperson", sellfoxSalesperson(view.salesperson));
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
