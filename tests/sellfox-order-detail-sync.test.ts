import test from "node:test";
import assert from "node:assert/strict";
import { sellfoxOrderDetailRow, sellfoxOrderDetailRows } from "../src/lib/sellfox/order-detail-contract";
import { syncSellfoxOrderDetail, type OrderDetailCheckpoint } from "../src/lib/sellfox/order-detail-sync";
import { SellfoxStoreSyncError } from "../src/lib/sellfox/sync-errors";

const baseRow = {
  shopId: "shop-1",
  sellerOrderId: "SO-1",
  amazonOrderId: "AMZ-1",
  orderStatus: "Shipped",
  orderTotalCurrency: "USD",
  orderTotalAmount: "12.34",
  productAmount: "10.00",
  commission: "1.50",
  orderProfit: "2.00",
  purchaseDate: "2026-11-01 10:00:00",
  isBusinessOrder: "false",
};

test("订单详情契约按文档抽取字段、金额转数值、缺失保留 null", () => {
  const row = sellfoxOrderDetailRow(baseRow, "shop-1");
  assert.equal(row.sellerOrderId, "SO-1");
  assert.equal(row.amazonOrderId, "AMZ-1");
  assert.equal(row.orderTotalAmount, 12.34);
  assert.equal(row.commission, 1.5);
  assert.equal(row.purchaseDate, "2026-11-01 10:00:00");
  assert.equal(row.refundPrice, null, "缺失金额保留 null，不补零");
  assert.equal(row.orderStatus, "Shipped");
  assert.equal((row.payload as Record<string, unknown>).sellerOrderId, "SO-1", "payload 原样保真");
});

test("订单详情契约校验身份与店铺归属，拒绝无效金额", () => {
  assert.throws(() => sellfoxOrderDetailRow({ ...baseRow, sellerOrderId: "" }, "shop-1"), /sellerOrderId/);
  assert.throws(() => sellfoxOrderDetailRow({ ...baseRow, shopId: "other" }, "shop-1"), /归属/);
  assert.throws(() => sellfoxOrderDetailRow({ ...baseRow, commission: "abc" }, "shop-1"), /数值无效/);
  // 行未回带 shopId 时不拒绝（部分接口形态），但身份仍必需
  const noShop = { ...baseRow };
  delete (noShop as Record<string, unknown>).shopId;
  assert.equal(sellfoxOrderDetailRow(noShop, "shop-1").sellerOrderId, "SO-1");
});

test("批量响应解析兼容 sellfoxPost 解包后的数组与未解包对象", () => {
  assert.equal(sellfoxOrderDetailRows([baseRow]).length, 1);
  assert.equal(sellfoxOrderDetailRows({ code: 0, data: [baseRow] }).length, 1);
  assert.throws(() => sellfoxOrderDetailRows({ code: 1, msg: "err" }), /data/);
});

function makeDeps(orderIds: string[], opts: { failPost?: boolean } = {}) {
  const rows = new Map<string, Record<string, unknown>>();
  const calls: string[][] = [];
  let postCalls = 0;
  let lastSnapshotSelect = "";
  const db = {
    sellfoxStore: { findMany: async () => [{ id: "store-1", externalId: "shop-1" }] },
    sellfoxOrderSnapshot: {
      // 真实快照只有 orderId(=amazonOrderId) 有值，sellerOrderId 恒为 null。
      findMany: async (args: { select: Record<string, unknown> }) => {
        lastSnapshotSelect = Object.keys(args.select ?? {}).join(",");
        return orderIds.map((orderId) => ({ orderId }));
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<void>) => {
      const pending = new Map(rows);
      const table = {
        upsert: async (args: { where: { storeId_sellerOrderId: { storeId: string; sellerOrderId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const k = `${args.where.storeId_sellerOrderId.storeId}|${args.where.storeId_sellerOrderId.sellerOrderId}`;
          pending.set(k, { ...(pending.get(k) ?? args.create), ...args.update });
        },
      };
      await fn({ sellfoxOrderDetail: table });
      // 模拟提交：把 pending 写回
      rows.clear();
      for (const [k, v] of pending) rows.set(k, v);
    },
  };
  const post = async (_path: string, body: { amazonOrderId: string; sellerOrderId?: string }) => {
    postCalls += 1;
    if (opts.failPost) throw new Error("private transport error");
    // 守护真实契约：必须用 amazonOrderId 参数，且不能误用 sellerOrderId。
    assert.equal(body.sellerOrderId, undefined, "不得使用 sellerOrderId 参数（订单列表接口不回带该字段）");
    assert.ok(body.amazonOrderId, "必须使用 amazonOrderId 参数驱动详情接口");
    const ids = body.amazonOrderId.split(",");
    calls.push(ids);
    return ids.map((id) => ({ ...baseRow, sellerOrderId: id, amazonOrderId: id, shopId: "shop-1" }));
  };
  return { db, post, rows, calls, getPostCalls: () => postCalls, getSnapshotSelect: () => lastSnapshotSelect };
}

test("订单详情同步按 200 分批、幂等写入、进度可续跑", async () => {
  const ids = Array.from({ length: 450 }, (_, i) => `SO-${i}`);
  const deps = makeDeps(ids);
  let checkpoint: OrderDetailCheckpoint | undefined;
  const result = await syncSellfoxOrderDetail({
    organizationId: "org", workspaceId: "default", shopExternalIds: ["shop-1"],
    capturedAt: new Date().toISOString(),
    onProgress: async (state) => { checkpoint = state; },
  }, deps as never);
  assert.deepEqual(deps.calls.map((c) => c.length), [200, 200, 50], "450 单应分 200/200/50 三批");
  assert.equal(deps.rows.size, 450, "全部订单详情应落库");
  assert.equal(result.count, 450);
  assert.equal(checkpoint?.["shop-1"].done, true);
  assert.equal(deps.getSnapshotSelect(), "orderId", "驱动查询必须读 orderId（=amazonOrderId），不能读恒空的 sellerOrderId");

  // 续跑：已完成店铺直接跳过
  const deps2 = makeDeps(ids);
  const result2 = await syncSellfoxOrderDetail({
    organizationId: "org", workspaceId: "default", shopExternalIds: ["shop-1"],
    capturedAt: new Date().toISOString(),
    checkpoint: { "shop-1": { processed: 450, done: true, count: 450 } },
    onProgress: async () => {},
  }, deps2 as never);
  assert.equal(deps2.getPostCalls(), 0, "已完成店铺不应再请求");
  assert.equal(result2.count, 450, "续跑计数沿用 checkpoint");
});

test("订单详情同步单店失败隔离并抛出可重试错误", async () => {
  const deps = makeDeps(["SO-1"], { failPost: true });
  await assert.rejects(
    syncSellfoxOrderDetail({
      organizationId: "org", workspaceId: "default", shopExternalIds: ["shop-1"],
      capturedAt: new Date().toISOString(), onProgress: async () => {},
    }, deps as never),
    SellfoxStoreSyncError,
  );
});
