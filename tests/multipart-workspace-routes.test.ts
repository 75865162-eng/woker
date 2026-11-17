import assert from "node:assert/strict";
import { File } from "node:buffer";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// 复用 account-security.test.ts 的隔离加载方式，真实执行路由、范围解析和两层工作区授权。
function loadModule<T>(file: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, unknown> = {};
  runInNewContext(compiled, {
    exports, require: (name: string) => {
      if (name === "@/lib/workspace/scope") return dependencies["@/lib/workspace/scope"];
      assert.ok(name in dependencies, `未声明的依赖：${name}`);
      return dependencies[name];
    },
    process: { env: { DATABASE_URL: "隔离依赖，无数据库连接", NODE_ENV: "test" } },
    Request, Response, URL, TextEncoder, File, Buffer, console,
  });
  return exports as T;
}

type Effect = { kind: string; data?: unknown };
type FileData = { workspaceId: string; organizationId: string; [key: string]: unknown };
type Route = { POST: (request: Request) => Promise<Response> };
const routes = [
  { name: "assets", file: "assets/upload", filename: "fixture.png", mime: "image/png", files: 1 },
  { name: "files", file: "files/upload", filename: "fixture.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", files: 1 },
  { name: "conclusion-files", file: "products/conclusion-files/upload", filename: "fixture.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", files: 1 },
  { name: "file-assets", file: "products/file-assets/upload", filename: "fixture.png", mime: "image/png", files: 3 },
  { name: "image-assets", file: "products/image-assets/upload", filename: "fixture.png", mime: "image/png", files: 3 },
  { name: "patent-files", file: "products/patent-files/upload", filename: "fixture.png", mime: "image/png", files: 2 },
  { name: "video-assets", file: "products/video-assets/upload", filename: "fixture.png", mime: "image/png", files: 1 },
  { name: "workbook-files", file: "workspace/workbook-files/upload", filename: "fixture.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", files: 1 },
] as const;

function fixture(route: typeof routes[number]) {
  const effects: Effect[] = [];
  const lookups: string[] = [];
  const fileRows: FileData[] = [];
  let job: Record<string, unknown>;
  const prisma = {
    organizationMember: { findUnique: async () => ({ role: "owner", user: { status: "active" } }) },
    workspaceScope: { findUnique: async ({ where }: { where: { organizationId_id: { organizationId: string; id: string } } }) => {
      assert.equal(where.organizationId_id.organizationId, "org-a");
      const id = where.organizationId_id.id;
      lookups.push(id);
      return id.startsWith("allowed-") ? { id } : null;
    } },
    fileObject: { create: async ({ data }: { data: FileData }) => {
      effects.push({ kind: "fileObject.create", data });
      fileRows.push(data);
      return { ...data, id: `file-${fileRows.length}`, createdAt: new Date(0) };
    } },
    importJob: {
      create: async ({ data }: { data: FileData }) => { effects.push({ kind: "importJob.create", data }); return job = { ...data, id: "job-a", status: "queued", progress: 0 }; },
      update: async (data: unknown) => { effects.push({ kind: "importJob.update", data }); },
      findUniqueOrThrow: async () => job,
    },
  };
  const scope = loadModule<typeof import("@/lib/workspace/scope")>("src/lib/workspace/scope.ts", {});
  const access = loadModule<typeof import("@/lib/workspace/access")>("src/lib/workspace/access.ts", {
    "@/lib/db/prisma": { prisma }, "@/lib/workspace/scope": scope,
  });
  const next = { NextResponse: { json: Response.json } };
  const permissions = loadModule<typeof import("@/lib/auth/api-permissions")>("src/lib/auth/api-permissions.ts", {
    "next/server": next,
    "@/lib/accounts/permissions": { roleCanPerformAction: () => true },
    "@/lib/auth/authorization-context": { getAuthorizationContext: async () => ({ user: { id: "user-a", organizationId: "org-a", role: "owner" }, permissions: {} }) },
    "@/lib/workspace/access": access,
    "@/lib/audit/access-denied": { recordAccessDenied: async () => true },
  });
  const storage = {
    putFile: async ({ key, file }: { key: string; file: File }) => { effects.push({ kind: "storage.putFile" }); return { key, size: file.size, contentType: file.type }; },
    putBuffer: async ({ key, buffer, contentType }: { key: string; buffer: Buffer; contentType: string }) => { effects.push({ kind: "storage.putBuffer" }); return { key, size: buffer.length, contentType }; },
  };
  const sharp = () => {
    effects.push({ kind: "sharp" });
    const chain = { rotate: () => chain, resize: () => chain, webp: () => chain, toBuffer: async () => Buffer.from("thumbnail") };
    return chain;
  };
  const api = loadModule<Route>(`src/app/api/${route.file}/route.ts`, {
    "node:crypto": { randomUUID }, "node:path": { default: path }, "next/server": next, "@prisma/client": {},
    "@/lib/auth/api-permissions": permissions, "@/lib/workspace/access": access, "@/lib/workspace/scope": scope, "@/lib/db/prisma": { prisma },
    "@/lib/storage": { getStorageDriver: () => { effects.push({ kind: "getStorageDriver" }); return storage; }, getStorageType: () => "fixture" },
    "@/lib/audit/versioning": { recordDataChangeVersion: async (data: unknown) => { effects.push({ kind: "audit", data }); } },
    "@/lib/queue": { enqueueImportJob: async (data: unknown) => { effects.push({ kind: "queue", data }); } },
    "@/lib/runtime/dispatch-persisted-job": { dispatchPersistedJob: async () => { effects.push({ kind: "dispatch" }); return { dispatchDeferred: false }; } },
    "@/lib/products/file-assets": { PRODUCT_ATTACHMENT_MAX_BYTES: 10 * 1024 * 1024 },
    "@/lib/products/image-preview": { createProductImagePreview: async () => { effects.push({ kind: "preview" }); return Buffer.from("preview"); } },
    sharp: { default: sharp },
  });
  const post = (workspace: string, query?: string, header?: string) => {
    const form = new FormData();
    form.set("workspaceId", workspace);
    form.set("file", new Blob(["fixture upload"], { type: route.mime }), route.filename);
    return api.POST(new Request(`http://fixture.invalid/api/${route.file}${query ? `?${query}` : ""}`, {
      method: "POST", headers: { cookie: "workspaceId=allowed-cookie", ...(header ? { "x-workspace-id": header } : {}) }, body: form,
    }));
  };
  return { effects, lookups, fileRows, post };
}

for (const route of routes) {
  for (const scenario of [
    { name: "合法query与header不能掩盖跨组织form", form: "denied-form", query: "workspaceId=allowed-query", header: "allowed-header", lookups: ["allowed-query", "allowed-header", "denied-form"] },
    { name: "仅form指定跨组织工作区也拒绝", form: "denied-form", lookups: ["denied-form"] },
    { name: "合法form与header不能掩盖跨组织query", form: "allowed-form", query: "workspaceId=denied-query", header: "allowed-header", lookups: ["denied-query"] },
    { name: "合法form与query不能掩盖跨组织header", form: "allowed-form", query: "workspaceId=allowed-query", header: "denied-header", lookups: ["allowed-query", "denied-header"] },
    { name: "重复query中的第二个跨组织选择器仍拒绝", form: "allowed-form", query: "workspaceId=allowed-query&workspaceId=denied-second", header: "allowed-header", lookups: ["allowed-query", "denied-second"] },
  ]) {
    test(`${route.name}：${scenario.name}，无存储、数据库、图像处理或队列副作用`, async () => {
      const state = fixture(route);
      const response = await state.post(scenario.form, scenario.query, scenario.header);
      assert.equal(response.status, 403, JSON.stringify(await response.json()));
      assert.deepEqual(state.lookups, scenario.lookups);
      assert.deepEqual(state.effects, []);
      assert.deepEqual(state.fileRows, []);
    });
  }

  for (const withSelectors of [false, true]) {
    test(`${route.name}：${withSelectors ? "同组织query/header与form不一致时按form写入" : "合法form单独指定工作区可成功上传"}`, async () => {
      const state = fixture(route);
      const response = await state.post("allowed-form", withSelectors ? "workspaceId=allowed-query" : undefined, withSelectors ? "allowed-header" : undefined);
      assert.equal(response.status, 200, JSON.stringify(await response.json()));
      assert.deepEqual(state.lookups, withSelectors ? ["allowed-query", "allowed-header", "allowed-form"] : ["allowed-form"]);
      assert.equal(state.fileRows.length, route.files);
      assert.ok(state.fileRows.every(row => row.workspaceId === "allowed-form" && row.organizationId === "org-a"));
      assert.ok(state.effects.some(effect => effect.kind.startsWith("storage.put")));
      if (route.name === "files") {
        assert.equal(state.effects.filter(effect => effect.kind === "importJob.create").length, 1);
        assert.equal(state.effects.filter(effect => effect.kind === "audit").length, 2);
        assert.equal(state.effects.filter(effect => effect.kind === "queue").length, 1);
      }
    });
  }
}
