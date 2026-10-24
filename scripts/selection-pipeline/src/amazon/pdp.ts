import type { Page } from "@playwright/test";
import type { Competitor } from "../types";
import { selectors } from "./selectors";
import type { RateLimit } from "./rateLimit";
export async function parsePdp(page: Page): Promise<Partial<Competitor>> {
  const raw = await page.evaluate(s => ({
    title: document.querySelector(s.title)?.textContent?.trim() ?? "",
    price: document.querySelector(s.price)?.textContent ?? "",
    rating: document.querySelector(s.rating)?.textContent ?? "",
    reviewsCount: document.querySelector(s.reviewsCount)?.textContent ?? "",
    ranks: document.querySelector(s.bsr)?.textContent ?? "",
    bullets: [...document.querySelectorAll(s.bullets)].map(el => el.textContent?.trim() ?? "").filter(Boolean),
    mainImageUrl: document.querySelector(s.image)?.getAttribute("data-old-hires") || document.querySelector<HTMLImageElement>(s.image)?.src || undefined,
    variations: [...document.querySelectorAll(s.variations)].map(el => el.textContent?.trim() || el.getAttribute("title") || "").filter(Boolean).slice(0,100),
  }), selectors);
  const num = (value: string) => { const m = value.replaceAll(",", "").match(/\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
  const ranks = raw.ranks.match(/Best Sellers Rank[\s\S]*?#([\d,]+)\s+in/i);
  return { title: raw.title, price: num(raw.price), rating: num(raw.rating), reviewsCount: num(raw.reviewsCount), bsr: ranks ? num(ranks[1]) : null, bullets: raw.bullets, mainImageUrl: raw.mainImageUrl, variations: raw.variations };
}
export async function pdp(page: Page, asin: string, limit: RateLimit) {
  await limit.navigate(page, `https://www.amazon.com/dp/${asin}`);
  return parsePdp(page);
}
