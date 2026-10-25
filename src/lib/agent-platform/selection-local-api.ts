import path from "node:path";
import { readdir } from "node:fs/promises";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { assertWorkspaceAccess } from "@/lib/workspace/access";
import { LocalSelectionError, localSelectionError, readLocalSelection, saveLocalEvidence, withSelectionLock } from "./selection-local";
import { readJson, writeJson } from "../../../scripts/selection-pipeline/src/io";
import { assertWriteQuality } from "../../../scripts/selection-pipeline/src/quality";
import { rebuildWorkbook } from "../../../scripts/selection-pipeline/src/local-workbook";
import type { Brief, Competitor, Draft } from "../../../scripts/selection-pipeline/src/types";

const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
async function body(request: Request): Promise<Record<string, unknown>> {
  // As in selection-evidence, prevent auth's JSON clone from buffering arbitrary input.
  if (request.headers.get("content-type")?.split(";")[0] !== "application/octet-stream") throw new LocalSelectionError("请使用选品表单提交。", 415);
  if (!request.body || Number(request.headers.get("content-length")) > 2 * 1024 * 1024) throw new LocalSelectionError("表单缺失或超过 2 MB。", 413);
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 2 * 1024 * 1024) throw new LocalSelectionError("表单超过 2 MB。", 413);
      chunks.push(next.value);
    }
  } finally { await reader.cancel(); }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LocalSelectionError("表单格式无效。");
  return value as Record<string, unknown>;
}
export async function selectionLocalApi(request: Request, operation: "slugs" | "local" | "reviews" | "suppliers") {
  try {
    if (request.method === "POST") {
      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(request.url).origin) throw new LocalSelectionError("请从本站提交表单。", 403);
      if (request.headers.get("content-type")?.split(";")[0] !== "application/octet-stream") throw new LocalSelectionError("请使用选品表单提交。", 415);
    }
    const permission = await requireApiPermission("agents", request.method === "GET" ? "view" : "create", request);
    if (!permission.ok) return json({ error: permission.response.status === 401 ? "请先登录。" : "没有当前工作区的 Agent 权限。" }, permission.response.status);
    const { user } = permission;
    const { workspaceId } = workspaceScopeFromRequest(request);
    if (!(await assertWorkspaceAccess(user.organizationId, workspaceId))) throw new LocalSelectionError("没有当前工作区的访问权限。", 403);
    let organizationId = process.env.SELECTION_ORGANIZATION_ID;
    if (!organizationId) {
      const organizations = await prisma.organization.findMany({ select: { id: true }, take: 2 });
      if (organizations.length === 1) organizationId = organizations[0].id;
    }
    if (organizationId !== user.organizationId || workspaceId !== (process.env.SELECTION_WORKSPACE_ID || "default")) throw new LocalSelectionError("本机选品目录未绑定当前组织/工作区，请管理员配置 SELECTION_ORGANIZATION_ID / SELECTION_WORKSPACE_ID。", 403);
    const environment = { organization: Boolean(organizationId), actor: Boolean(process.env.SELECTION_ACTOR_USER_ID || user.id), erpUrl: Boolean(process.env.SELECTION_ERP_URL), cookie: Boolean(process.env.SELECTION_ERP_COOKIE), database: Boolean(process.env.DATABASE_URL), actorMatches: !process.env.SELECTION_ACTOR_USER_ID || process.env.SELECTION_ACTOR_USER_ID === user.id };
    if (operation === "slugs") {
      const entries = await readdir(path.resolve("selections"), { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return []; throw e; });
      const slugs = [];
      for (const entry of entries.filter(e => e.isDirectory() && /^[a-z0-9][a-z0-9-]{0,79}$/.test(e.name)).sort((a,b) => a.name.localeCompare(b.name))) {
        try {
          const quality = await withSelectionLock(entry.name, dir => readJson<{ status: string; blockWrite: boolean }>(path.join(dir, "derived/quality.json")));
          slugs.push({ slug: entry.name, status: quality.status, blockWrite: quality.blockWrite });
        } catch (error) { const detail = localSelectionError(error); slugs.push({ slug: entry.name, status: "NEEDS_DATA", blockWrite: true, error: detail.error }); }
      }
      return json({ slugs, environment });
    }
    const input = request.method === "POST" ? await body(request) : {};
    const slug = request.method === "GET" ? new URL(request.url).searchParams.get("slug") : input.slug;
    if (typeof slug !== "string") throw new LocalSelectionError("请选择 Slug。");
    return await withSelectionLock(slug, async dir => {
      if (operation === "local" && request.method === "GET") return json({ ...await readLocalSelection(dir, slug, workspaceId), environment });
      if (operation === "reviews" || operation === "suppliers") return json({ ...await saveLocalEvidence(dir, slug, workspaceId, operation, input.rows), environment });
      const action = input.action;
      if (action !== "upload" && action !== "create") throw new LocalSelectionError("请选择有效操作。");
      const extra = await requireApiPermission("products", action === "upload" ? "edit" : "create", request);
      if (!extra.ok) throw new LocalSelectionError("没有商品上传/创建权限。", 403);
      const current = await readLocalSelection(dir, slug, workspaceId);
      assertWriteQuality(current.quality);
      if (current.quality.fixture) throw new LocalSelectionError("测试资料禁止上传和写库。", 403);
      const actorUserId = process.env.SELECTION_ACTOR_USER_ID || user.id;
      // A browser action must not borrow an env-configured administrator's authority.
      if (actorUserId !== user.id) throw new LocalSelectionError("选品操作者与当前登录用户不一致。", 403);
      const actor = await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: user.organizationId, userId: actorUserId } }, include: { user: true } });
      if (!actor || actor.user.status !== "active" || !["owner", "database_admin"].includes(actor.role)) throw new LocalSelectionError("需要当前组织有效的所有者或数据库管理员。", 403);
      if (action === "upload") {
        const origin = process.env.SELECTION_ERP_URL;
        const cookie = typeof input.cookie === "string" && input.cookie ? input.cookie : process.env.SELECTION_ERP_COOKIE;
        if (!origin || !cookie || cookie.length > 16000 || /[\r\n]/.test(cookie)) throw new LocalSelectionError("上传需要 ERP 地址和有效的一次性 Cookie。");
        const target = new URL(origin);
        if (target.protocol !== "https:" && !(target.protocol === "http:" && ["localhost", "127.0.0.1"].includes(target.hostname))) throw new LocalSelectionError("ERP 地址必须使用 HTTPS。");
        const identity = await fetch(new URL("/api/auth/me", target), { headers: { Cookie: cookie }, redirect: "error", signal: AbortSignal.timeout(10000), cache: "no-store" });
        const remote = await identity.json() as { user?: { id?: string; organizationId?: string } };
        if (!identity.ok || remote.user?.id !== user.id || remote.user?.organizationId !== user.organizationId) throw new LocalSelectionError("上传会话必须属于当前登录用户和组织。", 403);
        const competitors = await readJson<Competitor[]>(path.join(dir, "raw/competitors.json"));
        const { uploadImage } = await import("../../../scripts/selection-pipeline/src/images/upload");
        try {
          for (const competitor of competitors) {
            if (!competitor.imagePath || competitor.imageFileId && competitor.imageAsset?.id === competitor.imageFileId && competitor.imageUploadWorkspaceId === workspaceId) continue;
            if (!/^raw\/images\/[A-Za-z0-9._-]+\.(?:jpg|jpeg|png|webp)$/.test(competitor.imagePath)) throw new LocalSelectionError("本地图片路径无效。");
            const asset = await uploadImage(path.join(dir, competitor.imagePath), workspaceId, { origin, cookie });
            if (!asset) throw new LocalSelectionError("图片上传失败。");
            competitor.imageAsset = asset; competitor.imageFileId = asset.id; competitor.imageUploadWorkspaceId = workspaceId;
            await writeJson(path.join(dir, "raw/competitors.json"), competitors);
          }
        } finally { await rebuildWorkbook(dir, slug, await readJson<Brief>(path.join(dir, "brief.json")), workspaceId, true); }
        return json({ ...await readLocalSelection(dir, slug, workspaceId), environment });
      }
      if (!environment.database) throw new LocalSelectionError("数据库尚未配置。");
      await rebuildWorkbook(dir, slug, await readJson<Brief>(path.join(dir, "brief.json")), workspaceId);
      const draft = await readJson<Draft>(path.join(dir, "derived/draft.json"));
      const { productsCreate } = await import("../../../scripts/selection-pipeline/src/create/productsCreate");
      const receipt = await productsCreate(draft, workspaceId, { organizationId: user.organizationId, actorUserId });
      await writeJson(path.join(dir, "derived/created.json"), { ...receipt, slug, workspaceId, createdAt: new Date().toISOString(), uploadedImageFileIds: draft.competitors.flatMap(c => c.imageFileId ? [c.imageFileId] : []) });
      return json({ ...await readLocalSelection(dir, slug, workspaceId), environment, receipt });
    });
  } catch (error) { const failure = localSelectionError(error); return json({ error: failure.error }, failure.status); }
}
