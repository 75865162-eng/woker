import assert from "node:assert/strict";
import test from "node:test";
import { sellfoxScheduledBackfill } from "@/lib/sellfox/schedule-backfill";

test("scheduled daily sales continues during manual history without duplicating history or advancing its cursor", async () => {
  const db = { sellfoxSyncRun: { findFirst: async () => ({ id: "historical-run" }) }, $queryRaw: async () => { throw Error("must not scan"); }, sellfoxSyncSchedule: { update: async () => { throw Error("must not advance"); } } } as unknown as Parameters<typeof sellfoxScheduledBackfill>[0];
  assert.deepEqual(await sellfoxScheduledBackfill(db, { id: "plan", organizationId: "org", workspaceId: "ws", resource: "sales", backfillNextDate: "2025-11-01" }, new Date("2026-10-25T00:00:00Z"), 7), {});
});
test("after manual batch finishes the schedule resumes at first uncovered day, or skips verified complete history", async () => {
  let date: string | undefined = "2026-10-20";
  let cursor: string | undefined;
  const db = { sellfoxSyncRun: { findFirst: async () => null }, $queryRaw: async () => date ? [{ date }] : [], sellfoxSyncSchedule: { update: async ({ data }: { data: { backfillNextDate: string } }) => { cursor = data.backfillNextDate; } } } as unknown as Parameters<typeof sellfoxScheduledBackfill>[0];
  const scope = { id: "plan", organizationId: "org", workspaceId: "ws", resource: "sales", backfillNextDate: "2025-11-01" };
  const now = new Date("2026-10-25T00:00:00Z");
  assert.deepEqual(await sellfoxScheduledBackfill(db, scope, now, 7), { backfillFrom: "2026-10-20", backfillTo: "2026-10-24" });
  assert.equal(cursor, "2026-10-20");
  date = undefined;
  assert.deepEqual(await sellfoxScheduledBackfill(db, scope, now, 7), {});
  assert.equal(cursor, "2026-10-25");
});
