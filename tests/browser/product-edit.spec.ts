import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
import { productToDraft } from "@/components/products/product-workbench-data";
import type { Product } from "@/lib/products/types";
import type * as DraftRepository from "@/lib/products/product-edit-draft-repository";

let bundle: string;
test.beforeAll(async () => {
  const result = await build({ entryPoints: ["tests/browser/product-edit-harness.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, alias: { exceljs: "exceljs/dist/exceljs.min.js" } });
  bundle = result.outputFiles[0].text;
});

async function setup(page: Page) {
  const state = {
    product: { ...productToDraft(null, [], "SKU-1"), id: "product-1", revision: 1, chineseName: "原商品", englishName: "Original product", status: "listing_confirming" } as Product,
    saves: 0, uploads: 0, fail: false,
  };
  await page.route("http://127.0.0.1:43219/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/products" && request.method() === "POST") {
      state.saves++;
      const { product } = request.postDataJSON() as { product: Product };
      if (state.fail) return route.fulfill({ status: 500, json: { error: "模拟保存失败" } });
      if (product.revision !== state.product.revision) return route.fulfill({ status: 409, json: { conflict: true, error: "版本冲突", currentRevision: state.product.revision } });
      state.product = { ...product, revision: state.product.revision! + 1 };
      return route.fulfill({ json: { product: state.product } });
    }
    if (url.pathname.endsWith("/detail")) return route.fulfill({ json: { product: state.product } });
    if (url.pathname.endsWith("/upload")) {
      state.uploads++;
      return route.fulfill({ json: { asset: { id: `file-${state.uploads}`, name: "test.png", mimeType: "image/png", size: 1, storageType: "local", uploadedAt: "2026-10-20", thumbUrl: "/test.png", originalUrl: "/test.png" } } });
    }
    if (url.pathname.startsWith("/api/")) throw new Error(`Unexpected API call: ${request.method()} ${url.pathname}`);
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto("http://127.0.0.1:43219/");
  await expect(nameInput(page)).toBeEditable();
  return state;
}

function nameInput(page: Page) { return page.locator("label").filter({ hasText: "中文名（必填）" }).locator("input"); }
async function savedLocally(page: Page) { await expect(page.getByRole("status")).toContainText("草稿已暂存"); }

test("without randomUUID the editor loads and preserves drafts across refresh", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
  });
  const state = await setup(page);
  expect(await page.evaluate(() => typeof globalThis.crypto.randomUUID)).toBe("undefined");
  await nameInput(page).fill("兼容浏览器草稿");
  await savedLocally(page);
  await page.reload();
  await expect(page.getByRole("dialog")).toContainText("发现未提交的编辑内容");
  await page.getByRole("button", { name: "恢复草稿", exact: true }).click();
  await expect(nameInput(page)).toHaveValue("兼容浏览器草稿");
  expect(state.saves).toBe(0);
  expect(errors).toEqual([]);
});

test("autosave, refresh restore, continue editing and explicit discard never commit", async ({ page }) => {
  const state = await setup(page);
  await nameInput(page).fill("我的未提交商品");
  await savedLocally(page);
  expect(state.saves).toBe(0);
  await page.reload();
  await expect(page.getByRole("dialog")).toContainText("发现未提交的编辑内容");
  await page.getByRole("button", { name: "恢复草稿", exact: true }).click();
  await expect(nameInput(page)).toHaveValue("我的未提交商品");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(nameInput(page)).toHaveValue("我的未提交商品");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "放弃修改并关闭", exact: true }).click();
  await page.getByRole("button", { name: "打开编辑器" }).click();
  await expect(nameInput(page)).toHaveValue("原商品");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.saves).toBe(0);
  expect(state.product.revision).toBe(1);
});

test("409 retains draft; authoritative reload and explicit restore use latest CAS, repeated conflict stays manual", async ({ page }) => {
  const state = await setup(page);
  await nameInput(page).fill("我的修改");
  await savedLocally(page);
  state.product = { ...state.product, revision: 2, purchasePrice: 21 };
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("该商品已被其他用户修改");
  await page.getByRole("button", { name: "加载最新数据", exact: true }).click();
  await page.getByRole("button", { name: "恢复我的修改", exact: true }).click();
  await expect(nameInput(page)).toHaveValue("我的修改");
  expect(state.saves).toBe(1);
  state.product = { ...state.product, revision: 3, purchasePrice: 35 };
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("商品版本冲突");
  await page.getByRole("button", { name: "加载最新数据", exact: true }).click();
  await page.getByRole("button", { name: "恢复我的修改", exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("heading", { name: /商品详情/ })).toHaveCount(0);
  expect(state.product.revision).toBe(4);
  expect(state.product.chineseName).toBe("我的修改");
  expect(state.product.purchasePrice).toBe(35);
  await page.getByRole("button", { name: "打开编辑器" }).click();
  await expect(nameInput(page)).toHaveValue("我的修改");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("failed save, temporary leave and identity switching keep local edits isolated", async ({ page }) => {
  const state = await setup(page);
  await nameInput(page).fill("保留草稿");
  await savedLocally(page);
  state.fail = true;
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("模拟保存失败");
  await expect(nameInput(page)).toHaveValue("保留草稿");
  await page.getByRole("button", { name: "暂时离开（保留草稿）", exact: true }).click();
  await page.getByRole("button", { name: "打开编辑器" }).click();
  await expect(page.getByRole("dialog")).toContainText("发现未提交");
  await page.goto("http://127.0.0.1:43219/?user=user-2");
  await expect(nameInput(page)).toHaveValue("原商品");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("http://127.0.0.1:43219/?workspace=other");
  await expect(nameInput(page)).toHaveValue("原商品");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("http://127.0.0.1:43219/?org=other");
  await expect(nameInput(page)).toHaveValue("原商品");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("http://127.0.0.1:43219/");
  await expect(page.getByRole("dialog")).toContainText("发现未提交");
});

test("uploaded file ids and video edits survive reload without re-upload or automatic formal save", async ({ page }) => {
  const state = await setup(page);
  const imageInput = page.locator('input[type="file"][accept="image/*"]').first();
  await imageInput.setInputFiles({ name: "test.png", mimeType: "image/png", buffer: Buffer.from("image") });
  await savedLocally(page);
  await page.getByRole("button", { name: "视频", exact: true }).click();
  const videoNotes = page.locator("label").filter({ hasText: "道具 / 场景要求" }).locator("textarea");
  await videoNotes.fill("我的视频策划");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await savedLocally(page);
  await page.reload();
  await page.getByRole("button", { name: "恢复草稿", exact: true }).click();
  await page.getByRole("button", { name: "视频", exact: true }).click();
  await expect(videoNotes).toHaveValue("我的视频策划");
  expect(state.saves).toBe(0);
  expect(state.uploads).toBe(1);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("heading", { name: /商品详情/ })).toHaveCount(0);
  expect(state.product.imageAssets?.[0].id).toBe("file-1");
  expect(state.product.videoPlan?.propsSceneRequirements).toBe("我的视频策划");
});

test("discard during debounce cannot resurrect a draft, and reverting edits clears obsolete autosave", async ({ page }) => {
  const state = await setup(page);
  await nameInput(page).fill("快速取消");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "放弃修改并关闭", exact: true }).click();
  await page.getByRole("button", { name: "打开编辑器" }).click();
  await expect(nameInput(page)).toHaveValue("原商品");
  await nameInput(page).fill("随后还原");
  await savedLocally(page);
  await nameInput(page).fill("原商品");
  await page.getByRole("button", { name: "暂时离开（保留草稿）", exact: true }).click();
  await page.getByRole("button", { name: "打开编辑器" }).click();
  await expect(nameInput(page)).toHaveValue("原商品");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.saves).toBe(0);
});

test("IndexedDB failure is visible but normal explicit save remains available", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, "indexedDB", { get() { throw new Error("IndexedDB unavailable"); } }); });
  const state = await setup(page);
  await expect(page.getByRole("status")).toContainText("IndexedDB");
  await nameInput(page).fill("仍可保存");
  await expect(page.getByRole("status")).toContainText("暂存失败");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("商品已正式保存");
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  expect(state.product.chineseName).toBe("仍可保存");
  expect(state.saves).toBe(1);
  await page.getByRole("button", { name: "关闭（商品已保存）", exact: true }).click();
});

test("import seed remains an unsaved new-product draft across reload", async ({ page }) => {
  const state = await setup(page);
  await page.goto("http://127.0.0.1:43219/?mode=import");
  await savedLocally(page);
  expect(state.saves).toBe(0);
  await page.reload();
  await expect(page.getByRole("dialog")).toContainText("发现未提交");
  await page.getByRole("button", { name: "恢复草稿", exact: true }).click();
  await expect(nameInput(page)).toHaveValue("原商品");
  expect(state.product.revision).toBe(1);
});

test("IndexedDB repository isolates SKU/session records and conditional deletion preserves newer writes", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const repository = (window as unknown as { productDraftRepository: typeof DraftRepository }).productDraftRepository;
    const identity = { organizationId: "org-repository", workspaceId: "workspace", userId: "user", entityId: "SKU-1", editorType: "product" as const };
    const identityKey = repository.productDraftIdentityKey(identity);
    const record = {
      key: `${identityKey}:session-1`, identityKey, identity, schemaVersion: 1 as const,
      baseRevision: 4, original: { revision: 4, title: "original" }, form: { revision: 4, title: "draft" }, updatedAt: "2026-10-20T10:00:00.000Z",
    };
    await repository.writeProductDraft(record);
    await repository.writeProductDraft({ ...record, key: `${identityKey}:session-2` });
    const sessions = (await repository.readProductDrafts(identity)).length;
    const otherSku = (await repository.readProductDrafts({ ...identity, entityId: "SKU-2" })).length;
    const otherUser = (await repository.readProductDrafts({ ...identity, userId: "other-user" })).length;
    await repository.writeProductDraft({ ...record, updatedAt: "2026-10-20T11:00:00.000Z" });
    await repository.deleteProductDraft(record.key, record.updatedAt);
    const afterStaleDelete = await repository.readProductDrafts(identity);
    await repository.deleteProductDraft(record.key, "2026-10-20T11:00:00.000Z");
    const remaining = await repository.readProductDrafts(identity);
    return { sessions, otherSku, otherUser, afterStaleDelete: afterStaleDelete.length, remaining: remaining.map((item) => item.key) };
  });
  expect(result.sessions).toBe(2);
  expect(result.otherSku).toBe(0);
  expect(result.otherUser).toBe(0);
  expect(result.afterStaleDelete).toBe(2);
  expect(result.remaining).toHaveLength(1);
  expect(result.remaining[0]).toContain("session-2");
});

test("workbook attachment uploads block save/close until the uploaded reference joins the draft", async ({ page }) => {
  const state = await setup(page);
  let releaseUpload!: () => void;
  const gate = new Promise<void>((resolve) => { releaseUpload = resolve; });
  await page.route("**/api/products/file-assets/upload", async (route) => {
    await gate;
    await route.fulfill({ json: { asset: { id: "workbook-file", name: "evidence.pdf", mimeType: "application/pdf", size: 1, storageType: "local", uploadedAt: "2026-10-20", thumbUrl: "/evidence.pdf", originalUrl: "/evidence.pdf", downloadUrl: "/evidence.pdf" } } });
  });
  await page.locator('input[type="file"][accept="image/*,.pdf"]').last().setInputFiles({ name: "evidence.pdf", mimeType: "application/pdf", buffer: Buffer.from("pdf") });
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "暂时离开（保留草稿）", exact: true })).toBeDisabled();
  expect(state.saves).toBe(0);
  releaseUpload();
  await savedLocally(page);
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("heading", { name: /商品详情/ })).toHaveCount(0);
  const saved = state.product as Product & { workbookDetail: { remarkImageAssets: Array<{ id: string }> } };
  expect(saved.workbookDetail.remarkImageAssets[0].id).toBe("workbook-file");
});
