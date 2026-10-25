import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !databaseUrl.includes("127.0.0.1") || !databaseUrl.endsWith("/erp_cli_test")) throw new Error("Use npm run test:erp; this test never accepts an existing database");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const exec = promisify(execFile);
const org = "erp-test-org";
const owner = "erp-test-owner";
const viewer = "erp-test-viewer";
const workspace = "default";
const env = { ...process.env, DATABASE_URL: databaseUrl, ERP_ORGANIZATION_ID: org, ERP_ACTOR_USER_ID: owner, QUEUE_DRIVER: "inline" };
const draft = { version: 1, sku: `ERP-${randomUUID().slice(0, 8)}`, title: "CLI 集成商品", marketplace: "US", workspace, note: "kept", meta: { source: "integration" } };
let directory: string;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "erp-cli-"));
  await db.organization.create({ data: { id: org, name: "ERP CLI test", slug: org } });
  await db.user.create({ data: { id: owner, name: owner, email: `${owner}@example.invalid`, passwordHash: "test", status: "active" } });
  await db.user.create({ data: { id: viewer, name: viewer, email: `${viewer}@example.invalid`, passwordHash: "test", status: "active" } });
  await db.organizationMember.createMany({ data: [{ organizationId: org, userId: owner, role: "owner" }, { organizationId: org, userId: viewer, role: "viewer" }] });
});
after(async () => { await db.$disconnect(); if (directory) await rm(directory, { recursive: true, force: true }); });

async function draftFile(value: unknown) {
  const file = join(directory, `${randomUUID()}.json`);
  await writeFile(file, JSON.stringify(value));
  return file;
}

async function run(args: string[], actor = owner) {
  const result = await exec(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/erp-cli/src/cli.ts", ...args], { env: { ...env, ERP_ACTOR_USER_ID: actor }, maxBuffer: 1024 * 1024 });
  return JSON.parse(result.stdout.trim()) as Record<string, unknown>;
}

test("dry-run does not write, write creates, and get reads the SKU", async () => {
  const file = await draftFile(draft);
  const dryRun = await run(["products", "upsert", "--file", file]);
  assert.equal(dryRun.ok, true); assert.equal(dryRun.dryRun, true); assert.equal(await db.productRecord.count({ where: { organizationId: org, sku: draft.sku } }), 0);
  // Permission lookup must not lazily seed roles, nor produce any other writes.
  for (const model of [db.organizationRosterRole, db.workspaceScope, db.auditLog, db.dataChangeVersion, db.productOutboxEvent]) assert.equal(await (model.count as () => Promise<number>)(), 0);
  const written = await run(["products", "upsert", "--file", file, "--write"]);
  assert.equal(written.ok, true); assert.equal(written.dryRun, false); assert.ok(written.productId);
  assert.equal(await db.productRecord.count({ where: { organizationId: org, workspaceId: workspace, sku: draft.sku } }), 1);
  const read = await run(["products", "get", "--sku", draft.sku, "--workspace", workspace]);
  assert.equal(read.ok, true); assert.equal(read.productId, written.productId);
  assert.equal(await db.productSummaryRecord.count({ where: { organizationId: org, sku: draft.sku } }), 1);
  assert.equal(await db.productTextRecord.count({ where: { organizationId: org, productRecordId: String(written.productId) } }), 1);
  assert.equal(await db.auditLog.count({ where: { organizationId: org, entityId: draft.sku } }), 1);
});

test("viewer cannot write", async () => {
  const file = await draftFile({ ...draft, sku: `ERP-V-${randomUUID().slice(0, 8)}` });
  await assert.rejects(() => run(["products", "upsert", "--file", file, "--write"], viewer), (error: unknown) => {
    const result = JSON.parse((error as { stdout: string }).stdout);
    assert.equal(result.ok, false); assert.match(result.errors[0], /FORBIDDEN.*products:create/); return true;
  });
});

test("thin update preserves omitted values and rejects stale revision", async () => {
  const file = await draftFile({ version: 1, sku: draft.sku, title: "更新标题", marketplace: "US", workspace, imagePaths: ["/local/image.jpg"] });
  const result = await run(["products", "upsert", "--file", file, "--write"]);
  assert.deepEqual(result.warnings, ["IMAGES_NEED_UPLOAD"]);
  const read = await run(["products", "get", "--sku", draft.sku]);
  const product = read.product as Record<string, unknown>;
  assert.equal(product.note, "kept"); assert.equal(product.chineseName, "更新标题");
  assert.deepEqual(product.meta, { source: "integration" }); assert.equal(product.revision, 2);
  assert.equal(product.imageFileId, undefined); assert.equal(product.imagePaths, undefined);
  const stale = await draftFile({ ...draft, revision: 1 });
  await assert.rejects(() => run(["products", "upsert", "--file", stale, "--write"]), (error: unknown) => {
    assert.match(JSON.parse((error as { stdout: string }).stdout).errors[0], /REVISION_CONFLICT/); return true;
  });
});

test("dry-run update is read only and requires edit permission", async () => {
  const file = await draftFile({ ...draft, title: "不会保存" });
  await run(["products", "upsert", "--file", file]);
  assert.equal((await db.productRecord.findFirstOrThrow({ where: { sku: draft.sku } })).revision, 2);
  await assert.rejects(() => run(["products", "upsert", "--file", file], viewer), (error: unknown) => {
    const result = JSON.parse((error as { stdout: string }).stdout);
    assert.equal(result.dryRun, true); assert.match(result.errors[0], /products:edit/); return true;
  });
});

test("fixture and invalid status cannot write", async () => {
  for (const patch of [{ fixture: true }, { status: "listed" }]) {
    const sku = `ERP-INVALID-${randomUUID()}`;
    const file = await draftFile({ ...draft, sku, ...patch });
    await assert.rejects(() => run(["products", "upsert", "--file", file, "--write"]));
    assert.equal(await db.productRecord.count({ where: { sku } }), 0);
  }
});

test("permissions are read from persisted role catalog and inactive users fail", async () => {
  await db.organizationRosterRole.create({ data: { organizationId: org, id: "viewer", name: "custom", description: "test permissions", permissions: { products: ["view", "create"] } } });
  const sku = `ERP-CUSTOM-${randomUUID()}`;
  const file = await draftFile({ ...draft, sku });
  assert.equal((await run(["products", "upsert", "--file", file, "--write"], viewer)).ok, true);
  await assert.rejects(() => run(["products", "upsert", "--file", file, "--write"], viewer));
  await db.user.update({ where: { id: viewer }, data: { status: "disabled" } });
  await assert.rejects(() => run(["products", "get", "--sku", sku], viewer));
});

test("missing SKU is machine readable and exits nonzero", async () => {
  await assert.rejects(() => run(["products", "get", "--sku", "does-not-exist"]), (error: unknown) => {
    assert.deepEqual(JSON.parse((error as { stdout: string }).stdout).errors, ["NOT_FOUND"]); return true;
  });
});
