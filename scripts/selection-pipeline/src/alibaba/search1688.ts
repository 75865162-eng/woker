import type { Page } from "@playwright/test";
import type { Supplier } from "../types";
import type { RateLimit } from "../amazon/rateLimit";
import { selectors } from "../amazon/selectors";
import { PipelineError } from "../io";
export function validateSuppliers(value: unknown, max: number): Supplier[] {
  if (!Array.isArray(value)) throw new PipelineError("INVALID_SUPPLIERS_FILE");
  const rows = value.map(row => {
    if (!row || typeof row.title !== "string" || !row.title.trim() || typeof row.url !== "string") throw new PipelineError("INVALID_SUPPLIER");
    const url = new URL(row.url);
    if (url.protocol !== "https:" || url.hostname !== "detail.1688.com" || !/^\/offer\/\d+\.html$/.test(url.pathname)) throw new PipelineError("INVALID_SUPPLIER_URL");
    for (const field of ["price","moq","shopName"] as const) if (row[field] != null && typeof row[field] !== "string") throw new PipelineError("INVALID_SUPPLIER_FIELD");
    return { title: row.title.slice(0,500), url: url.origin + url.pathname, price: row.price ?? "", moq: row.moq ?? "", shopName: row.shopName ?? "" };
  });
  return [...new Map(rows.map(r => [r.url,r])).values()].slice(0,max);
}
export async function parse1688(page: Page): Promise<Supplier[]> {
  const cards = await page.locator(selectors.supplierCard).evaluateAll((cards,s) => cards.map(card => ({
    title: card.querySelector(s.supplierTitle)?.textContent?.trim() || card.querySelector(s.supplierLink)?.getAttribute("title") || "",
    url: card.querySelector<HTMLAnchorElement>(s.supplierLink)?.href ?? "",
    price: card.querySelector(s.supplierPrice)?.textContent?.trim() ?? "",
    moq: card.querySelector(s.supplierMoq)?.textContent?.trim() ?? "",
    shopName: card.querySelector(s.supplierShop)?.textContent?.trim() ?? "",
  })),selectors);
  return cards.filter(c => c.title && c.url);
}
export async function search1688(page: Page, keyword: string, max: number, limit: RateLimit) {
  await limit.navigate(page, `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(keyword)}`);
  await page.locator(selectors.supplierCard).first().waitFor({ timeout: 10000 }).catch(() => {});
  const suppliers = validateSuppliers(await parse1688(page),max);
  if (!suppliers.length) throw new PipelineError("SUPPLIERS_EMPTY_OR_BLOCKED");
  return suppliers;
}
