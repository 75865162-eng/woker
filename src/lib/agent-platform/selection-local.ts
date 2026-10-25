import path from "node:path";
import { lstat, readdir, realpath, open, unlink } from "node:fs/promises";
import { selectionDir } from "../../../scripts/selection-pipeline/src/config";
import { PipelineError, readJson, writeJson } from "../../../scripts/selection-pipeline/src/io";
import { validateSuppliers } from "../../../scripts/selection-pipeline/src/alibaba/search1688";
import { inspectQuality, loadReviews } from "../../../scripts/selection-pipeline/src/quality";
import { rebuildWorkbook } from "../../../scripts/selection-pipeline/src/local-workbook";
import { parseWebReviews, parseWebSuppliers, tagLocalReviews } from "../../../scripts/selection-pipeline/src/local-evidence";
import type { Brief, Competitor, Draft, Supplier, TagsResult } from "../../../scripts/selection-pipeline/src/types";

export class LocalSelectionError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

// Existing CLI slugs are operator-owned. Refuse symlinks anywhere in this small evidence tree,
// including derived/reviews targets, before invoking pipeline functions which write fixed paths.
export async function safeSelectionDirectory(slug: string) {
  let dir: string;
  try { dir = selectionDir(slug); } catch { throw new LocalSelectionError("Slug 格式无效。"); }
  if ((await lstat(path.resolve("selections"))).isSymbolicLink()) throw new LocalSelectionError("选品根目录不允许使用符号链接。");
  const root = await realpath(path.resolve("selections"));
  const info = await lstat(dir).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink() || path.dirname(await realpath(dir)) !== root) throw new LocalSelectionError("选品目录不存在或路径不安全。", 404);
  let count = 0;
  async function check(folder: string, depth = 0) {
    if (depth > 8) throw new LocalSelectionError("选品目录层级过深。");
    for (const item of await readdir(folder, { withFileTypes: true })) {
      if (++count > 10000) throw new LocalSelectionError("选品目录文件过多。");
      if (item.isSymbolicLink()) throw new LocalSelectionError("选品目录不允许包含符号链接。");
      if (item.isDirectory()) await check(path.join(folder, item.name), depth + 1);
    }
  }
  await check(dir);
  return dir;
}
export async function withSelectionLock<T>(slug: string, task: (dir: string) => Promise<T>) {
  const dir = await safeSelectionDirectory(slug);
  const lockPath = path.join(dir, ".pipeline.lock");
  const lock = await open(lockPath, "wx").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") throw new LocalSelectionError("流水线占用中，请稍后重试。", 409);
    throw error;
  });
  try { return await task(dir); }
  finally { await lock.close(); await unlink(lockPath); }
}
async function optionalJson<T>(file: string, fallback: T): Promise<T> {
  try { return await readJson<T>(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback; throw error; }
}
export async function readLocalSelection(dir: string, slug: string, workspaceId: string) {
  const brief = await readJson<Brief>(path.join(dir, "brief.json"));
  if (typeof brief.keyword !== "string" || !brief.keyword.trim() || brief.keyword.length > 300) throw new LocalSelectionError("本地选品关键词无效。");
  const competitors = await readJson<Competitor[]>(path.join(dir, "raw/competitors.json"));
  if (!Array.isArray(competitors) || competitors.some(c => !/^[A-Z0-9]{10}$/.test(c.asin))) throw new LocalSelectionError("本地竞品 ASIN 数据无效。");
  const reviews = await loadReviews(dir, competitors.map(c => c.asin));
  const suppliers = validateSuppliers(await optionalJson<Supplier[]>(path.join(dir, "derived/suppliers.json"), []), 20);
  const tags = await optionalJson<TagsResult>(path.join(dir, "derived/tags.json"), { matches: [], countByTag: {}, countByAsin: {} });
  const { buildDraft } = await import("../../../scripts/selection-pipeline/src/workbook/buildDraft");
  const draft = await optionalJson<Draft | null>(path.join(dir, "derived/draft.json"), null);
  const current = buildDraft(slug, brief, competitors, suppliers, tags);
  current.fixture = draft?.fixture || /fixture|offline-acceptance/.test(slug);
  current.quality = draft?.quality;
  const quality = await inspectQuality(dir, current, false, workspaceId);
  // Return only UI fields, never arbitrary local file contents or product payloads.
  return { slug, keyword: brief.keyword, asins: competitors.map(c => c.asin), reviews, suppliers, quality };
}
export type LocalSelection = Awaited<ReturnType<typeof readLocalSelection>>;
export async function saveLocalEvidence(dir: string, slug: string, workspaceId: string, kind: "reviews" | "suppliers", value: unknown) {
  const current = await readLocalSelection(dir, slug, workspaceId);
  if (kind === "reviews") await tagLocalReviews(dir, parseWebReviews(value, current.asins));
  else {
    const rows = parseWebSuppliers(value);
    await writeJson(path.join(dir, "derived/suppliers.json"), rows);
    // Ensure the first manual supplier save also works when tag was never run.
    if (!(await optionalJson<TagsResult | null>(path.join(dir, "derived/tags.json"), null))) await tagLocalReviews(dir);
  }
  if (kind === "reviews") {
    const suppliers = await optionalJson<Supplier[]>(path.join(dir, "derived/suppliers.json"), []);
    await writeJson(path.join(dir, "derived/suppliers.json"), suppliers);
  }
  await rebuildWorkbook(dir, slug, await readJson<Brief>(path.join(dir, "brief.json")), workspaceId);
  return readLocalSelection(dir, slug, workspaceId);
}
export function localSelectionError(error: unknown) {
  if (error instanceof LocalSelectionError) return { error: error.message, status: error.status };
  if (error instanceof PipelineError) {
    if (error.message.startsWith("QUALITY_BLOCK_WRITE")) return { error: "证据门禁未通过，请先补齐评论、标签、供应商和图片，并核对当前 quality。", status: 400 };
    if (error.message === "FIXTURE_WRITE_FORBIDDEN") return { error: "测试资料或离线虚构供应商不能用于上传/写库，请填写真实证据。", status: 400 };
    if (["ERP_IMAGE_UPLOAD_FAILED", "INVALID_UPLOAD_RESPONSE"].includes(error.message)) return { error: "图片上传失败，请检查 ERP 会话、商品编辑权限和返回附件；已成功的附件会保留。", status: 400 };
  }
  if (error instanceof PipelineError || error instanceof TypeError || error instanceof SyntaxError) return { error: "证据格式无效：评论须为当前竞品的 1–3 星真实原文（≤240 字）；供应商须为至少 3 条不同的真实 HTTPS 1688 商品链接，禁止测试数据。", status: 400 };
  return { error: "本地选品处理失败，请检查本机文件后重试。", status: 500 };
}
