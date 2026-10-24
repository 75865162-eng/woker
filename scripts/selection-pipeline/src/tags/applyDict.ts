import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import type { Review, Tag, TagsResult } from "../types";
import { PipelineError } from "../io";
export type DictionaryEntry = { key: string; name: string; keywords: string[]; patterns?: string[] };
export async function loadDictionary(file: string): Promise<DictionaryEntry[]> {
  const value: unknown = parse(await readFile(file,"utf8"));
  if (!Array.isArray(value) || value.length > 200) throw new PipelineError("INVALID_DICTIONARY");
  for (const item of value) {
    if (!item || typeof item.key !== "string" || !/^[a-z_]{1,50}$/.test(item.key) || typeof item.name !== "string" || !Array.isArray(item.keywords) || item.keywords.some((v: unknown) => typeof v !== "string" || !v)) throw new PipelineError("INVALID_DICTIONARY_ENTRY");
    if (item.patterns && (!Array.isArray(item.patterns) || item.patterns.some((v: unknown) => typeof v !== "string" || v.length > 200))) throw new PipelineError("INVALID_DICTIONARY_REGEX");
    for (const pattern of item.patterns ?? []) new RegExp(pattern, "i");
  }
  return value as DictionaryEntry[];
}
export function applyDict(reviews: Review[], dictionary: DictionaryEntry[]) {
  const matches: Tag[] = []; const unmatched: Review[] = [];
  const compiled = dictionary.map(d => ({ ...d, regex: (d.patterns ?? []).map(p => new RegExp(p,"i")) }));
  for (const review of reviews) {
    let hit = false;
    for (const entry of compiled) {
      if (entry.keywords.some(k => review.text.toLowerCase().includes(k.toLowerCase())) || entry.regex.some(r => r.test(review.text))) {
        matches.push({ asin: review.asin, tag: entry.key, quote: review.text, source: "dictionary" }); hit = true;
      }
    }
    if (!hit) unmatched.push(review);
  }
  return { matches, unmatched };
}
export function aggregateTags(matches: Tag[]): TagsResult {
  const unique = [...new Map(matches.map(t => [JSON.stringify([t.asin,t.tag,t.quote]),t])).values()];
  const countByTag: Record<string, number> = Object.create(null);
  const countByAsin: Record<string, Record<string, number>> = Object.create(null);
  for (const t of unique) {
    countByTag[t.tag] = (countByTag[t.tag] ?? 0) + 1;
    const counts = countByAsin[t.asin] ??= Object.create(null);
    counts[t.tag] = (counts[t.tag] ?? 0) + 1;
  }
  return { matches: unique, countByTag, countByAsin };
}
