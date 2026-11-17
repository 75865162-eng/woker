import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "zustand/vanilla";
import { createElement, type Dispatch, type SetStateAction } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useWorkspaceStore } from "../src/lib/stores/workspace-store";
import { createPersistenceSlice } from "../src/lib/stores/workspace-persistence-slice";
import { createCampaignSlice } from "../src/lib/stores/workspace-campaign-slice";
import { createRulesDraftsSlice } from "../src/lib/stores/workspace-rules-drafts-slice";
import { createBulkImportSlice } from "../src/lib/stores/workspace-bulk-import-slice";
import { createOverallAdDataSlice } from "../src/lib/stores/workspace-overall-ad-data-slice";
import { initializeWorkspacePersistence } from "../src/lib/stores/workspace-store-persistence";
import { writeWorkspaceSnapshot, deleteWorkspaceSnapshot, writeWorkspaceDraftRun } from "../src/lib/repositories/workspace-repository";
import { takeWorkspaceSnapshot } from "../src/lib/workspace/workspace-snapshot";
import { workspaceScopeChangedEventName } from "../src/lib/workspace/workspace-scope-events";
import type { WorkspaceState } from "../src/lib/stores/workspace-state";
import { productToDraft } from "../src/components/products/product-workbench-data";
import { useProductWorkbookEditing } from "../src/components/products/use-product-workbook-editing";
import { Card, CardContent, CardHeader } from "../src/components/ui/card";
import { Section, SectionBody, SectionHeader } from "../src/components/ui/section";
import { Surface, SurfaceBody, SurfaceHeader } from "../src/components/ui/surface";

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test("工作区订阅只注册一次，切换清空旧状态且延迟旧快照不能覆盖新状态", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalFetch = globalThis.fetch;
  const events = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: events });
  let scope = "a";
  let releaseOld: ((response: Response) => void) | undefined;
  let reads = 0;
  const writes: Array<{ scope: string; snapshot: { activeCampaignGroupId: string } }> = [];
  const initial = useWorkspaceStore.getInitialState();
  const snapshot = (id: string) => ({ ...takeWorkspaceSnapshot(initial), activeCampaignGroupId: id, openTabIds: [id] });
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("draft-runs")) return Response.json({ draftRuns: [] });
    if (options?.method === "PUT") {
      writes.push({ scope, snapshot: JSON.parse(String(options.body)).snapshot });
      return Response.json({ ok: true });
    }
    reads += 1;
    if (reads === 1) return new Promise<Response>((resolve) => { releaseOld = resolve; });
    return Response.json({ snapshot: snapshot(scope), version: 1 });
  };
  let cleanup: (() => void) | undefined;
  try {
    const store = createStore<WorkspaceState>((set, get, api) => ({ ...createCampaignSlice(set, get, api), ...createRulesDraftsSlice(set, get, api), ...createBulkImportSlice(set, get, api), ...createOverallAdDataSlice(set, get, api), ...createPersistenceSlice(set, get, api) }));
    let subscriptions = 0;
    const subscribe = store.subscribe;
    store.subscribe = (listener) => { subscriptions += 1; return subscribe(listener); };
    cleanup = initializeWorkspacePersistence(store);
    assert.equal(initializeWorkspacePersistence(store), cleanup);
    assert.equal(subscriptions, 1);
    assert.equal(reads, 1);
    store.getState().openCampaignGroup("temporary-a");
    scope = "b";
    events.dispatchEvent(new Event(workspaceScopeChangedEventName));
    assert.deepEqual(store.getState().openTabIds, []);
    await turn();
    assert.equal(store.getState().activeCampaignGroupId, "b");
    assert.ok(releaseOld);
    releaseOld(Response.json({ snapshot: snapshot("stale-a"), version: 1 }));
    await turn();
    assert.equal(store.getState().activeCampaignGroupId, "b");
    assert.equal(typeof store.getState().setRules, "function");
    store.getState().openCampaignGroup("b-edit");
    await new Promise<void>((resolve) => setTimeout(resolve, 550));
    assert.deepEqual(writes.map((write) => [write.scope, write.snapshot.activeCampaignGroupId]), [["b", "b-edit"]]);
    store.getState().openCampaignGroup("b-pending");
    scope = "c";
    events.dispatchEvent(new Event(workspaceScopeChangedEventName));
    await turn();
    await new Promise<void>((resolve) => setTimeout(resolve, 550));
    assert.equal(store.getState().activeCampaignGroupId, "c");
    assert.equal(writes.length, 1, "切换前待保存定时器不能写入新工作区");
  } finally {
    cleanup?.();
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("持久化清理幂等，取消旧恢复与待保存，并允许重新初始化", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalFetch = globalThis.fetch;
  const events = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: events });
  const store = createStore<WorkspaceState>((set, get, api) => ({ ...createCampaignSlice(set, get, api), ...createRulesDraftsSlice(set, get, api), ...createBulkImportSlice(set, get, api), ...createOverallAdDataSlice(set, get, api), ...createPersistenceSlice(set, get, api) }));
  let reads = 0;
  let writes = 0;
  let releaseOld: ((response: Response) => void) | undefined;
  let cleanup: (() => void) | undefined;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("draft-runs")) return Response.json({ draftRuns: [] });
    if (options?.method === "PUT") { writes++; return Response.json({ ok: true }); }
    reads++;
    if (reads === 1) return new Promise<Response>((resolve) => { releaseOld = resolve; });
    return Response.json({ snapshot: { ...takeWorkspaceSnapshot(store.getInitialState()), activeCampaignGroupId: "fresh" }, version: 1 });
  };
  try {
    cleanup = initializeWorkspacePersistence(store);
    assert.ok(cleanup);
    assert.equal(initializeWorkspacePersistence(store), cleanup);
    cleanup();
    cleanup();
    events.dispatchEvent(new Event(workspaceScopeChangedEventName));
    assert.equal(reads, 1, "清理后事件不再触发读取");
    assert.ok(releaseOld);
    releaseOld(Response.json({ snapshot: { ...takeWorkspaceSnapshot(store.getInitialState()), activeCampaignGroupId: "disposed-stale" }, version: 1 }));
    await turn();
    assert.notEqual(store.getState().activeCampaignGroupId, "disposed-stale", "进行中的恢复不得在清理后落地");
    const previousCleanup = cleanup;
    cleanup = initializeWorkspacePersistence(store);
    assert.notEqual(cleanup, previousCleanup);
    await turn();
    assert.equal(reads, 2);
    assert.equal(store.getState().activeCampaignGroupId, "fresh");
    store.getState().openCampaignGroup("pending");
    cleanup?.();
    store.getState().openCampaignGroup("after-dispose");
    events.dispatchEvent(new Event(workspaceScopeChangedEventName));
    await new Promise<void>((resolve) => setTimeout(resolve, 550));
    assert.equal(writes, 0);
    assert.equal(reads, 2);
  } finally {
    cleanup?.();
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("恢复失败不得把默认空状态自动写回覆盖存储", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  const store = createStore<WorkspaceState>((set, get, api) => ({ ...createCampaignSlice(set, get, api), ...createRulesDraftsSlice(set, get, api), ...createBulkImportSlice(set, get, api), ...createOverallAdDataSlice(set, get, api), ...createPersistenceSlice(set, get, api) }));
  let writes = 0;
  let cleanup: (() => void) | undefined;
  globalThis.fetch = async (url, options) => {
    if (options?.method === "PUT") { writes++; return Response.json({ ok: true }); }
    if (String(url).includes("draft-runs")) return Response.json({ draftRuns: [] });
    throw new Error("fixture recovery failure");
  };
  try {
    cleanup = initializeWorkspacePersistence(store);
    await turn();
    assert.equal(store.getState().persistenceStatus, "failed");
    store.getState().openCampaignGroup("must-not-save");
    await new Promise<void>((resolve) => setTimeout(resolve, 550));
    assert.equal(writes, 0);
  } finally {
    cleanup?.();
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("清空旧工作区的延迟结果不能覆盖后来恢复的新工作区", async () => {
  const originalFetch = globalThis.fetch;
  const store = createStore<WorkspaceState>((set, get, api) => ({ ...createCampaignSlice(set, get, api), ...createRulesDraftsSlice(set, get, api), ...createBulkImportSlice(set, get, api), ...createOverallAdDataSlice(set, get, api), ...createPersistenceSlice(set, get, api) }));
  let releaseDelete: ((response: Response) => void) | undefined;
  globalThis.fetch = async (url, options) => {
    if (options?.method === "DELETE") return new Promise<Response>((resolve) => { releaseDelete = resolve; });
    if (String(url).includes("draft-runs")) return Response.json({ draftRuns: [] });
    return Response.json({ snapshot: { ...takeWorkspaceSnapshot(store.getInitialState()), activeCampaignGroupId: "new-scope" }, version: 1 });
  };
  try {
    const pendingClear = store.getState().clearPersistedWorkspace();
    await store.getState().hydratePersistedWorkspace();
    assert.equal(store.getState().activeCampaignGroupId, "new-scope");
    assert.ok(releaseDelete);
    releaseDelete(Response.json({ ok: true }));
    await pendingClear;
    assert.equal(store.getState().activeCampaignGroupId, "new-scope");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("持久化未授权写入和删除不能假报成功", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: "fixture unauthorized" }, { status: 401 });
  try {
    await assert.rejects(writeWorkspaceSnapshot({}), /fixture unauthorized/);
    await assert.rejects(deleteWorkspaceSnapshot(), /fixture unauthorized/);
    await assert.rejects(writeWorkspaceDraftRun({
      record: { id: "fixture", ranAt: "2026-01-01T00:00:00Z", campaignGroupIds: [], campaignGroupNames: [], adjustmentDrafts: [], overallAdDataRows: [], overallAdDataMatchSummary: useWorkspaceStore.getInitialState().overallAdDataMatchSummary },
      rules: [],
    }), /fixture unauthorized/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("商品工作簿编辑清空保留 null，显式零保留，新空行不补零且不串改原草稿", () => {
  let draft = productToDraft(null, []);
  const original = structuredClone(draft);
  const setDraft: Dispatch<SetStateAction<typeof draft>> = (action) => { draft = typeof action === "function" ? action(draft) : action; };
  const actions = useProductWorkbookEditing(setDraft);
  actions.updateWorkbookPricingRow(0, "purchaseCost", null);
  assert.equal(draft.workbookDetail.pricingRows[0].purchaseCost, null);
  actions.updateWorkbookPricingRow(0, "purchaseCost", 0);
  assert.equal(draft.workbookDetail.pricingRows[0].purchaseCost, 0);
  actions.updateWorkbookPricingRow(0, "actualWeightKg", "");
  assert.equal(draft.workbookDetail.pricingRows[0].actualWeightKg, null);
  actions.updateWorkbookSupplier(0, "cost100", null);
  assert.equal(draft.workbookDetail.suppliers[0].cost100, null);
  actions.addWorkbookSupplier();
  assert.equal(draft.workbookDetail.suppliers.at(-1)?.cost300, null);
  draft = { ...draft, workbookDetail: { ...draft.workbookDetail, pricingRows: [] } };
  actions.addWorkbookPricingRow();
  assert.equal(draft.workbookDetail.pricingRows[0].suggestedPrice, null);
  assert.equal(draft.workbookDetail.pricingRows[0].exchangeRate, 6.9);
  assert.equal(original.workbookDetail.pricingRows[0].purchaseCost, null);
});

test("Card 与 Section 共享唯一底层并保留标签、内距和头部语义", () => {
  assert.strictEqual(Card, Surface);
  assert.strictEqual(CardHeader, SurfaceHeader);
  assert.strictEqual(CardContent, SurfaceBody);
  assert.strictEqual(SectionBody, SurfaceBody);
  const card = renderToStaticMarkup(createElement(Card, null, "内容"));
  assert.match(card, /^<div class="rounded-lg border border-border bg-surface">/);
  const section = renderToStaticMarkup(createElement(Section, null, createElement(SectionHeader, { title: "标题", actions: "操作" })));
  assert.match(section, /^<section/);
  assert.match(section, /overflow-hidden/);
  assert.match(section, /border-b border-border px-4 py-3/);
  assert.match(section, /标题/);
  assert.match(section, /操作/);
});
