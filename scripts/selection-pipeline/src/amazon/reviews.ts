import type { Page } from "@playwright/test";
import type { Review } from "../types";
import { selectors } from "./selectors";
import type { RateLimit } from "./rateLimit";
export async function parseReviews(page: Page, asin: string): Promise<Review[]> {
  return page.locator(selectors.review).evaluateAll((cards, { s, asin }) => cards.flatMap(card => {
    const star = Number(card.querySelector(s.reviewStar)?.textContent?.match(/[1-5](?:\.0)?/)?.[0]);
    const text = card.querySelector(s.reviewText)?.textContent?.replace(/\s+/g," ").trim().slice(0,240) ?? "";
    return star >= 1 && star <= 3 && text ? [{ asin, star, date: card.querySelector(s.reviewDate)?.textContent?.trim() ?? "", text }] : [];
  }), { s: selectors, asin });
}
export async function reviews(page: Page, asin: string, max: number, limit: RateLimit): Promise<Review[]> {
  const result: Review[] = [];
  const seen = new Set<string>();
  for (let pageNumber = 1; pageNumber <= Math.min(10, Math.ceil(max / 10)); pageNumber++) {
    await limit.navigate(page, `https://www.amazon.com/product-reviews/${asin}/?filterByStar=critical&pageNumber=${pageNumber}`);
    const batch = await parseReviews(page, asin);
    for (const review of batch) {
      const key = `${review.date}:${review.text}`;
      if (!seen.has(key)) { seen.add(key); result.push(review); }
    }
    if (result.length >= max || !batch.length || !await page.locator(selectors.nextReviews).count()) break;
  }
  return result.slice(0, max);
}
