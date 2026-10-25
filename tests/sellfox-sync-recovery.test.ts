import test from "node:test";
import assert from "node:assert/strict";
import { syncSellfoxProductDailySnapshots, type PerformanceCheckpoint } from "@/lib/sellfox/product-performance";
import { SellfoxStoreSyncError } from "@/lib/sellfox/sync-errors";
import { sellfoxPost } from "@/lib/sellfox/client";

type Dependencies = NonNullable<Parameters<typeof syncSellfoxProductDailySnapshots>[1]>;
const input = { organizationId: "org-a", workspaceId: "workspace-a", reportDate: "2026-10-24" };

function fixture(storeIds = ["a", "b"]) {
  let rows = new Map<string, unknown>();
  let checkpoint: PerformanceCheckpoint | undefined;
  let failCommit = false;
  let pendingCheckpoint: PerformanceCheckpoint | undefined;
  const calls: { shop: string; page: number }[] = [];
  const modes: boolean[] = [];
  let response: (shop: string, page: number) => unknown = () => ({ rows: [], totalPage: 0 });
  const db = {
    sellfoxStore: { findMany: async (args: { where: { organizationId: string; workspaceId: string } }) => {
      assert.equal(args.where.organizationId, input.organizationId);
      assert.equal(args.where.workspaceId, input.workspaceId);
      return storeIds.map((externalId) => ({ id: `store-${externalId}`, externalId }));
    } },
    $transaction: async (callback: (tx: unknown) => Promise<void>) => {
      const pending = new Map(rows);
      pendingCheckpoint = undefined;
      const tx = { sellfoxProductDailySnapshot: { upsert: async (args: { create: { id: string } }) => { pending.set(args.create.id, args.create); },
        deleteMany: async ({where}: {where: {onlySettle: boolean; syncedAt: {not: Date}}}) => {
          for (const [key, value] of pending) {
            const row = value as {onlySettle: boolean; syncedAt: Date};
            if (row.onlySettle === where.onlySettle && row.syncedAt.getTime() !== where.syncedAt.not.getTime()) pending.delete(key);
          }
        } } };
      await callback(tx);
      if (failCommit) { failCommit = false; throw new Error("DB query with private payload must not escape"); }
      rows = pending;
      if (pendingCheckpoint) checkpoint = pendingCheckpoint;
    },
  } as unknown as Dependencies["db"];
  const post = (async (_path: string, args: { shopIdList: string[]; pageNo: number; onlySettle: boolean }) => {
    modes.push(args.onlySettle);
    calls.push({ shop: args.shopIdList[0], page: args.pageNo });
    return response(args.shopIdList[0], args.pageNo);
  }) as typeof sellfoxPost;
  return {
    dependencies: { db, post }, calls, modes,
    get rows() { return rows; }, get checkpoint() { return checkpoint; },
    setResponse(fn: typeof response) { response = fn; }, failNextCommit() { failCommit = true; },
    async onProgress(update: { checkpoint: PerformanceCheckpoint }, tx?: unknown) {
      if (tx) pendingCheckpoint = structuredClone(update.checkpoint);
      else checkpoint = structuredClone(update.checkpoint);
    },
  };
}

const page = (prefix: string, size: number, totalPage: number) => ({ rows: Array.from({ length: size }, (_, index) => ({ mskuList: [`${prefix}-${index}`], saleNum: 1 })), totalPage });

test("page transaction rollback retains the failed page; retry replays it and skips completed stores", async () => {
  const f = fixture();
  f.setResponse((shop, pageNo) => shop === "a" ? page(`a-${pageNo}`, 100, 2) : page("b", 1, 1));
  f.failNextCommit();
  const onProgress = f.onProgress;
  await assert.rejects(() => syncSellfoxProductDailySnapshots({ ...input, onProgress }, f.dependencies), (error) => error instanceof SellfoxStoreSyncError && error.retryable);
  assert.equal(f.rows.size, 1);
  assert.equal(f.checkpoint?.stores.a.pageNo, 1);
  assert.equal(f.checkpoint?.stores.a.synced, 0);
  assert.match(f.checkpoint?.stores.a.error ?? "", /本地快照提交失败/);
  assert.doesNotMatch(JSON.stringify(f.checkpoint), /private payload/);
  assert.equal(f.checkpoint?.stores.b.done, true);
  const result = await syncSellfoxProductDailySnapshots({ ...input, checkpoint: f.checkpoint }, f.dependencies);
  assert.equal(result.synced, 201);
  assert.equal(f.rows.size, 201);
  assert.deepEqual(f.calls, [{ shop: "a", page: 1 }, { shop: "b", page: 1 }, { shop: "a", page: 1 }, { shop: "a", page: 2 }]);
  // Replaying independently is safe because business-key upserts replace rows.
  await syncSellfoxProductDailySnapshots({ ...input }, f.dependencies);
  assert.equal(f.rows.size, 201);
});

test("a committed first page resumes at page two and preserves committed counts", async () => {
  const f = fixture(["a"]);
  f.setResponse((_shop, pageNo) => { if (pageNo === 2) throw new Error("transport failure"); return page("a", 100, 2); });
  await assert.rejects(() => syncSellfoxProductDailySnapshots({ ...input, onProgress: f.onProgress }, f.dependencies));
  assert.equal(f.rows.size, 100);
  assert.equal(f.checkpoint?.stores.a.pageNo, 2);
  assert.equal(f.checkpoint?.stores.a.synced, 100);
  f.setResponse(() => page("a-tail", 1, 2));
  const result = await syncSellfoxProductDailySnapshots({ ...input, checkpoint: f.checkpoint }, f.dependencies);
  assert.equal(result.synced, 101);
  assert.equal(f.rows.size, 101);
  assert.deepEqual(f.calls.map((call) => call.page), [1, 2, 2]);
});

test("invalid schema and missing identities fail without writes, while a legal empty page succeeds", async () => {
  for (const response of [{ unexpected: [] }, { rows: [{}], totalPage: 1 }, page("duplicate", 1, 0)]) {
    const f = fixture(["a"]); f.setResponse(() => response);
    await assert.rejects(() => syncSellfoxProductDailySnapshots({ ...input, onProgress: f.onProgress }, f.dependencies), (error) => error instanceof SellfoxStoreSyncError && !error.retryable);
    assert.equal(f.rows.size, 0);
  }
  const empty = fixture(["a"]);
  assert.equal((await syncSellfoxProductDailySnapshots(input, empty.dependencies)).synced, 0);
  await assert.rejects(() => syncSellfoxProductDailySnapshots(input, fixture([]).dependencies), /没有可同步店铺/);
  await assert.rejects(() => syncSellfoxProductDailySnapshots({ ...input, storeExternalIds: ["a", "missing"] }, fixture(["a"]).dependencies), /不属于当前工作区/);
});

test("corrupt checkpoints cannot silently finish or send invalid page requests", async () => {
  const f = fixture(["a"]);
  await assert.rejects(() => syncSellfoxProductDailySnapshots({ ...input, checkpoint: { stores: { a: { pageNo: 10001, synced: 0, done: true } } } }, f.dependencies), /同步失败/);
  assert.equal(f.calls.length, 0);
});


test("onlySettle is requested and stored as a separate profit scope without replacing all-orders rows", async () => {
  const f = fixture(["a"]); f.setResponse(() => page("same-msku", 1, 1));
  await syncSellfoxProductDailySnapshots(input, f.dependencies);
  const result = await syncSellfoxProductDailySnapshots({ ...input, onlySettle: true }, f.dependencies);
  assert.deepEqual(f.modes, [false, true]); assert.equal(result.onlySettle, true);
  assert.equal(f.rows.size, 2);
  assert.deepEqual([...f.rows.values()].map(row => (row as { onlySettle: boolean }).onlySettle), [false, true]);
});


test("complete empty settled response clears only prior settled scope, while failed requests retain it", async () => {
  const f = fixture(["a"]); f.setResponse(() => page("same", 1, 1));
  await syncSellfoxProductDailySnapshots({...input, capturedAt:"2026-10-25T00:00:00Z"}, f.dependencies);
  await syncSellfoxProductDailySnapshots({...input, onlySettle:true, capturedAt:"2026-10-25T00:00:00Z"}, f.dependencies);
  f.setResponse(() => { throw Error("transport failure"); });
  await assert.rejects(() => syncSellfoxProductDailySnapshots({...input, onlySettle:true, capturedAt:"2026-10-25T01:00:00Z"}, f.dependencies));
  assert.equal(f.rows.size, 2);
  f.setResponse(() => ({rows:[],totalPage:0}));
  await syncSellfoxProductDailySnapshots({...input, onlySettle:true, capturedAt:"2026-10-25T01:00:00Z"}, f.dependencies);
  assert.equal(f.rows.size, 1);
  assert.equal(([...f.rows.values()][0] as {onlySettle:boolean}).onlySettle, false);
});


test("settled IDs cannot collide with an all-orders MSKU that ends in settled", async () => {
  const f = fixture(["a"]);
  f.setResponse(() => ({rows:[{mskuList:["MSKU-settled"],saleNum:1}],totalPage:1}));
  await syncSellfoxProductDailySnapshots(input, f.dependencies);
  f.setResponse(() => ({rows:[{mskuList:["MSKU"],saleNum:1}],totalPage:1}));
  await syncSellfoxProductDailySnapshots({...input,onlySettle:true}, f.dependencies);
  assert.equal(f.rows.size,2);
});
