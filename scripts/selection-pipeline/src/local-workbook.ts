import path from "node:path";
import { readJson, writeJson, log } from "./io";
import type { Brief, Competitor, Draft, Supplier, TagsResult } from "./types";
import { buildDraft } from "./workbook/buildDraft";
import { buildXlsx } from "./workbook/buildXlsx";
import { inspectQuality } from "./quality";
export async function rebuildWorkbook(dir: string, slug: string, brief: Brief, workspaceId = "default", requireUploadedImages = false) {
  const [competitors,tags,supplierRows] = await Promise.all([
    readJson<Competitor[]>(path.join(dir,"raw/competitors.json")),readJson<TagsResult>(path.join(dir,"derived/tags.json")),readJson<Supplier[]>(path.join(dir,"derived/suppliers.json")),
  ]);
  // Preserve the draft identity across rebuilds for database idempotency.
  const draft = buildDraft(slug,brief,competitors,supplierRows,tags);
  draft.fixture = (await readJson<{ fixture: boolean }>(path.join(dir,"raw/collection-info.json"))).fixture;
  try { const prior = await readJson<Draft>(path.join(dir,"derived/draft.json")); draft.product.id = prior.product.id; draft.quality = prior.quality; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  draft.quality = await inspectQuality(dir, draft, requireUploadedImages, workspaceId);
  await writeJson(path.join(dir,"derived/draft.json"),draft);
  await buildXlsx(draft,path.join(dir,"derived/workbook.xlsx"));
  await writeJson(path.join(dir,"derived/quality.json"), draft.quality);
  log("quality_evaluated", { status: draft.quality.status, blockWrite: draft.quality.blockWrite, reasons: draft.quality.reasons });
  log("workbook_complete",{ path: path.join(dir,"derived/workbook.xlsx"), competitors: competitors.length });
}
