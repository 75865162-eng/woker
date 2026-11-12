import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import { accountToolsForLili, credentialAllowsTool, amazonAccountReadTools } from "@/lib/lili/account-tool-access";

test("Lili inheritance needs a live server-issued OAuth grant; names cannot impersonate it", async () => {
  let revokedAt: Date | null = null, expiresAt = new Date(Date.now() + 60_000), present = true;
  const db = { liliOAuthGrant: { findUnique: async () => present ? { revokedAt, expiresAt, resource: "http://fixture/api/lili/mcp" } : null } } as unknown as Prisma.TransactionClient;
  const device = { id: "device", name: "Lili device: fixture", tools: [] };
  for (const name of ["research_step", "research_confirm", "workflow_sync_confirm", "data_sync_start", "amazon.ads.reports.list"]) assert.equal(await credentialAllowsTool(device, name, db), true);
  assert.equal(await credentialAllowsTool(device, "arbitrary_admin_write", db), false);
  assert.deepEqual(new Set(await accountToolsForLili({ id: "legacy", name: "legacy", tools: ["data_query"] }, db)), new Set(amazonAccountReadTools));
  present=false;assert.deepEqual(await accountToolsForLili(device,db),amazonAccountReadTools);present=true;
  revokedAt=new Date();assert.deepEqual(await accountToolsForLili(device,db),amazonAccountReadTools);revokedAt=null;
  expiresAt=new Date(0);assert.deepEqual(await accountToolsForLili(device,db),amazonAccountReadTools);
});
