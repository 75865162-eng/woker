
import type { HostPage, HostStatus } from "./host-page-schema";
export type { HostStatus, HostPriority, HostColumnKind, HostColumn, HostDataset, HostPage } from "./host-page-schema";
import { productsHostPage } from "./host-page-products";
import { profitHostPage } from "./host-page-profit";
import { adsHostPage } from "./host-page-ads";
import { inventoryHostPage } from "./host-page-inventory";
import { purchaseHostPage } from "./host-page-purchase";
import { financeHostPage } from "./host-page-finance";
export const hostPages: HostPage[] = [productsHostPage, profitHostPage, adsHostPage, inventoryHostPage, purchaseHostPage, financeHostPage];

export function hostPage(id: string) {
  return hostPages.find((page) => page.id === id);
}

export function hostDataset(datasetId: string) {
  for (const page of hostPages) {
    const dataset = page.datasets.find((item) => item.id === datasetId);
    if (dataset) return { page, dataset };
  }
  return null;
}

export const sellfoxNavOrder = [
  "/sellfox/products",
  "/sellfox/listings",
  "/sellfox/sales",
  "/sellfox/performance",
  "/sellfox/profit",
  "/sellfox/orders",
  "/sellfox/ads",
  "/sellfox/inventory",
  "/sellfox/restock",
  "/sellfox/purchase",
  "/sellfox/shipments",
  "/sellfox/finance",
  "/sellfox/dimensions",
  "/sellfox/sync",
  "/sellfox",
] as const;

export function hostStatusLabel(status: HostStatus) {
  return status === "live" ? "已接入" : status === "planned" ? "待接入" : "需授权";
}

export function hostSummary() {
  const datasets = hostPages.flatMap((page) => page.datasets);
  return {
    pages: hostPages.length,
    datasets: datasets.length,
    live: datasets.filter((item) => item.status === "live").length,
    planned: datasets.filter((item) => item.status === "planned").length,
    blocked: datasets.filter((item) => item.status === "blocked").length,
  };
}
