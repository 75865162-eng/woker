import type { Page } from "@playwright/test";
import type { Competitor } from "../types";
import { selectors } from "./selectors";
import type { RateLimit } from "./rateLimit";
export async function parseSearch(page: Page): Promise<Competitor[]> {
  const cards = await page.locator(selectors.searchCard).evaluateAll((cards, s) => cards.map(card => ({
    asin: card.getAttribute("data-asin") ?? "",
    title: card.querySelector(s.searchTitle)?.textContent?.trim() ?? "",
    price: card.querySelector(s.searchPrice)?.textContent,
    rating: card.querySelector(s.searchRating)?.textContent,
    reviewsCount: card.querySelector(s.searchReviews)?.textContent,
  })), selectors);
  const number = (text: string | null | undefined) => {
    const match = text?.replaceAll(",", "").match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  };
  return cards.filter(c => /^[A-Z0-9]{10}$/.test(c.asin) && c.title).map(c => ({
    ...c, url: `https://www.amazon.com/dp/${c.asin}`, price: number(c.price), rating: number(c.rating), reviewsCount: number(c.reviewsCount),
  }));
}
export async function search(page: Page, keyword: string, limit: RateLimit) {
  await limit.navigate(page, `https://www.amazon.com/s?k=${encodeURIComponent(keyword)}`);
  return parseSearch(page);
}
