import type { AdType, AdsScope, AdsStatus, AdsReport } from "../types";
export const DEMO_TODAY = "2026-11-05";
export const demoAccounts = [{ id: "northstar", name: "Northstar Home · 品牌账户" }, { id: "evergreen", name: "Evergreen Living · 品牌账户" }];
export const demoMarkets = [{ id: "US", name: "美国", currency: "USD", flag: "🇺🇸" }, { id: "CA", name: "加拿大", currency: "CAD", flag: "🇨🇦" }, { id: "UK", name: "英国", currency: "GBP", flag: "🇬🇧" }, { id: "DE", name: "德国", currency: "EUR", flag: "🇩🇪" }];
const products = ["Bamboo Drawer Organizer", "Linen Storage Basket", "Ceramic Soap Dispenser", "Kitchen Shelf Organizer", "Cotton Throw Blanket", "Wooden Serving Tray", "Glass Food Container", "Woven Laundry Basket"];
export function campaignFixtures(scope: AdsScope) {
  const prefix = `${scope.account}-${scope.marketplace}`;
  return Array.from({ length: 64 }, (_, i) => ({
    id: `${prefix}-c${i + 1}`, name: `${scope.marketplace} | ${products[i % products.length]} | ${["Exact", "Phrase", "Category", "Auto"][i % 4]} | ${String(i + 1).padStart(2, "0")}`,
    status: (i % 11 === 7 ? "archived" : i % 7 === 3 ? "paused" : "enabled") as AdsStatus,
    adType: (i % 9 === 6 ? "SB" : i % 9 === 7 ? "SD" : "SP") as AdType,
    budget: 20 + (i % 8) * 10, start: "2026-09-01", end: "—", product: products[i % products.length], index: i,
  }));
}
export function groupFixtures(scope: AdsScope) {
  return campaignFixtures(scope).flatMap(c => Array.from({ length: 6 }, (_, i) => ({
    id: `${c.id}-g${i + 1}`, campaignId: c.id, campaign: c.name, adType: c.adType,
    name: `${c.product} - ${["Core keywords", "High intent", "Long tail", "Competitors", "Discovery", "Brand defense"][i]}`,
    status: (i === 4 ? "paused" : "enabled") as AdsStatus, bid: 0.45 + i * 0.15, start: c.start, end: c.end, index: c.index * 6 + i,
  })));
}

export function reportFixtures(scope: AdsScope): AdsReport[] {
  return (["ready", "generating", "failed"] as const).map((status, i) => ({
    ...scope, id: `fixture-${i}`, name: ["Campaign 周报", "搜索词报告", "广告位报告"][i],
    type: (["campaigns", "search-terms", "placements"] as const)[i], adType: "SP",
    from: "2026-10-30", to: "2026-11-05", status, createdAt: "2026-11-05 09:00",
  }));
}
