import type { Page } from "@playwright/test";
import type { Competitor } from "../types";
import { selectors } from "./selectors";
import type { RateLimit } from "./rateLimit";
export async function bestsellers(page: Page, url: string, limit: RateLimit): Promise<Competitor[]> {
  await limit.navigate(page, url);
  return page.locator(selectors.bestCard).evaluateAll((cards, s) => cards.flatMap(card => {
    const a = card.querySelector<HTMLAnchorElement>(s.bestLink);
    const asin = a?.href.match(/\/dp\/([A-Z0-9]{10})/)?.[1];
    const title = a?.textContent?.trim() || a?.querySelector("img")?.alt || "";
    return asin && title ? [{ asin, title, url: `https://www.amazon.com/dp/${asin}`, price: null, rating: null, reviewsCount: null }] : [];
  }), selectors);
}
