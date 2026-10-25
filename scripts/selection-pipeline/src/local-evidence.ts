import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { pipelineRoot } from "./config";
import { PipelineError, readJson, writeJson } from "./io";
import { loadReviews, validateReviews } from "./quality";
import { validateSuppliers } from "./alibaba/search1688";
import { aggregateTags, applyDict, loadDictionary } from "./tags/applyDict";
import type { Competitor, Review, Supplier } from "./types";

export function parseWebReviews(value: unknown, asins: string[]): Review[] {
  const rows = validateReviews(value, new Set(asins));
  if (!rows.length) throw new PipelineError("REVIEWS_NEEDS_DATA");
  return rows;
}
export function parseWebSuppliers(value: unknown): Supplier[] {
  const rows = validateSuppliers(value, 20);
  if (rows.length < 3) throw new PipelineError("SUPPLIERS_NEEDS_DATA");
  if (rows.some(row => /\/offer\/10000000000[123]\.html$/.test(row.url) || row.shopName === "fixture-only")) throw new PipelineError("FIXTURE_WRITE_FORBIDDEN");
  return rows;
}
export async function tagLocalReviews(dir: string, imported?: Review[], dictionaryFile = path.join(pipelineRoot, "src/tags/dictionary.yaml")) {
  const competitors = await readJson<Competitor[]>(path.join(dir, "raw/competitors.json"));
  if (imported) {
    // A web editor is a complete snapshot, including deletions. CLI imports retain their merge semantics.
    const rows = validateReviews(imported, new Set(competitors.map(c => c.asin)));
    await mkdir(path.join(dir, "raw/reviews"), { recursive: true });
    for (const { asin } of competitors) {
      await writeFile(path.join(dir, `raw/reviews/${asin}.jsonl`), rows.filter(r => r.asin === asin).map(r => JSON.stringify(r)).join("\n") + "\n");
    }
  }
  const rows = await loadReviews(dir, competitors.map(c => c.asin));
  const result = applyDict(rows, await loadDictionary(dictionaryFile));
  await writeJson(path.join(dir, "derived/tags.json"), aggregateTags(result.matches));
}
