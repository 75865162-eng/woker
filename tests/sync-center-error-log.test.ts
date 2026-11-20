import assert from "node:assert/strict";
import test from "node:test";
import { logUnexpectedSyncCenterError as logUnexpected } from "@/lib/amazon-sync/log-unexpected";

/** 捕获 console.error 一次调用的参数，避免污染测试输出。 */
function captureError(fn: () => void): unknown[][] {
  const original = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => { calls.push(args); };
  try { fn(); } finally { console.error = original; }
  return calls;
}

test("sync-center 500 兜底记录错误类型、Prisma code 与字段名", () => {
  const [args] = captureError(() => logUnexpected({
    name: "PrismaClientKnownRequestError",
    code: "P2025",
    meta: { target: ["amazonSyncRun_sellerAccountId_fkey"] },
    message: "secret refreshToken=abc123 organizationId=secret-tenant",
  }));
  const detail = args?.[1] as Record<string, unknown>;
  assert.equal(args?.[0], "[operations.sync-center]");
  assert.equal(detail?.name, "PrismaClientKnownRequestError");
  assert.equal(detail?.code, "P2025");
  assert.equal(typeof detail?.field, "string");
});

test("sync-center 500 兜底不泄露 message / 凭证 / 堆栈", () => {
  const [args] = captureError(() => logUnexpected(Object.assign(new Error("refreshToken=TOPSECRET lwaClientSecret=LEAK"), {
    code: "P1001",
    meta: { target: ["__internal_column__"], extra: "refreshToken=LEAK" },
  })));
  const serialized = JSON.stringify(args);
  assert.ok(!serialized.includes("TOPSECRET"), "不得记录 Error.message");
  assert.ok(!serialized.includes("LEAK"), "不得记录 meta 中的非字段内容");
  assert.ok(!serialized.includes("stack"), "不得记录堆栈");
  const detail = args?.[1] as Record<string, unknown>;
  assert.equal(detail?.name, "Error");
  assert.equal(detail?.code, "P1001");
});

test("sync-center 500 兜底记录 P2039 的 SQLSTATE 与驱动类型", () => {
  const [args] = captureError(() => logUnexpected({
    name: "PrismaClientKnownRequestError",
    code: "P2039",
    meta: { driverAdapterError: { cause: { kind: "postgres", originalCode: "25P02", originalMessage: "current transaction is aborted: refreshToken=LEAK" } } },
  }, "overview"));
  const detail = args?.[1] as Record<string, unknown>;
  assert.equal(detail?.code, "P2039");
  assert.equal(detail?.sqlstate, "25P02");
  assert.equal(detail?.driver, "postgres");
  assert.equal(detail?.section, "overview");
  const serialized = JSON.stringify(args);
  assert.ok(!serialized.includes("LEAK"), "不得记录 driverAdapterError.cause.originalMessage");
});

test("sync-center 500 兜底对畸形 driverAdapterError 安全降级", () => {
  for (const badMeta of [{ driverAdapterError: "x" }, { driverAdapterError: { cause: "y" } }, { driverAdapterError: { cause: { originalCode: "bad-code", kind: {} } } }]) {
    const [args] = captureError(() => logUnexpected({ name: "PrismaClientKnownRequestError", code: "P2039", meta: badMeta }, "bad section!"));
    const detail = args?.[1] as Record<string, unknown>;
    assert.equal(detail?.code, "P2039");
    assert.equal(detail?.sqlstate, undefined);
    assert.equal(detail?.section, undefined);
  }
});

test("sync-center 500 兜底对畸形异常安全降级，不抛错", () => {
  for (const bad of [null, undefined, 42, "boom", { name: 123, code: {}, meta: "x" }]) {
    const calls = captureError(() => logUnexpected(bad));
    assert.equal(calls.length, 1);
    const detail = calls[0]?.[1] as Record<string, unknown>;
    assert.equal(detail?.name, "UnknownError");
  }
});
