import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildDraft } from "./src/workbook/buildDraft";
import { aggregateTags } from "./src/tags/applyDict";
import { writeJson, readJson } from "./src/io";
const databaseUrl = process.env.SELECTION_TEST_DATABASE_URL;
if (!databaseUrl || !/^selection-pipeline-test-[a-f0-9]{12}$/.test(process.env.SELECTION_TEST_CONTAINER ?? "")) throw new Error("Use npm run test:selection:create; this test never accepts an existing database");
const parsedUrl = new URL(databaseUrl);
if (parsedUrl.hostname !== "127.0.0.1" || parsedUrl.username !== "selection_test" || parsedUrl.pathname !== "/selection_pipeline_test" || databaseUrl !== process.env.DATABASE_URL) throw new Error("Unsafe integration database scope");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const exec = promisify(execFile);
const testId = randomUUID();
const org = `selection-test-${testId}`;
const owner = `owner-${testId}`;
const viewer = `viewer-${testId}`;
const workspaceId = "selection-test";
const paths: string[] = [];
type Receipt = { sku: string; productId: string; revision: number; queuePending: boolean };
before(async () => {
  await db.organization.create({ data: { id: org, name: "Selection isolated test", slug: org } });
  for (const [id,role] of [[owner,"owner"],[viewer,"viewer"]] as const) {
    await db.user.create({ data: { id, name: id, email: `${id}@example.invalid`, passwordHash: "not-a-login-hash", status: "active" } });
    await db.organizationMember.create({ data: { organizationId: org, userId: id, role } });
  }
  await db.workspaceScope.create({ data: { organizationId: org, id: workspaceId, name: "Test", accountId: "preserve-account", marketplace: "US" } });
});
after(async () => { await db.$disconnect(); for (const dir of paths) await rm(dir,{ recursive: true, force: true }); });
async function prepare() {
  const slug = `selection-db-test-${randomUUID()}`;
  const dir = path.resolve("selections",slug); paths.push(dir);
  const draft = buildDraft(slug,{ keyword: "isolated integration test", chineseName: "隔离测试商品" },[{ asin: "B012345678",title: "Synthetic integration record",url: "https://www.amazon.com/dp/B012345678",price: 20,rating: 4,reviewsCount: 100, imagePath: "raw/images/B012345678.jpg" }],Array.from({ length: 3 }, (_, i) => ({ title: "Isolated database test only", shopName: "", price: "", moq: "", url: `https://detail.1688.com/offer/23456789000${i}.html` })),aggregateTags([{ asin: "B012345678", tag: "size", quote: "poor fit", source: "dictionary" }]));
  await mkdir(path.join(dir,"derived"),{ recursive: true });
  await mkdir(path.join(dir,"raw/images"),{ recursive: true });
  await mkdir(path.join(dir,"raw/reviews"),{ recursive: true });
  await copyFile(path.resolve("scripts/selection-pipeline/fixtures/product.jpg"),path.join(dir,"raw/images/B012345678.jpg"));
  await writeFile(path.join(dir,"raw/reviews/B012345678.jsonl"),JSON.stringify({ asin: "B012345678", star: 2, date: "", text: "poor fit" }) + "\n");
  await writeJson(path.join(dir,"raw/collection-info.json"),{ fixture: false });
  await writeJson(path.join(dir,"brief.json"),draft.brief);
  await writeJson(path.join(dir,"derived/draft.json"),draft);
  return { slug,dir,draft };
}
async function create(item: Awaited<ReturnType<typeof prepare>>, actor = owner, workspace = workspaceId) {
  const result = await exec(process.execPath,["node_modules/tsx/dist/cli.mjs","scripts/selection-pipeline/src/cli.ts","create","--slug",item.slug,"--write","--workspace-id",workspace],{
    timeout: 60000,maxBuffer: 1024*1024,env: { ...process.env, DATABASE_URL: databaseUrl!, SELECTION_ORGANIZATION_ID: org, SELECTION_ACTOR_USER_ID: actor, SELECTION_ERP_URL: "", SELECTION_ERP_COOKIE: "", QUEUE_DRIVER: "inline" },
  });
  const entry = result.stdout.split("\n").filter(v => v.startsWith("{")).map(v => JSON.parse(v) as Record<string,unknown>).find(v => v.event === "product_created");
  assert.ok(entry,"CLI must return product_created receipt");
  return entry as unknown as Receipt;
}
test("real aggregate create: audit, revision, outbox, list projections and workspace preserved",async () => {
  const item = await prepare(); const receipt = await create(item);
  assert.equal(receipt.revision,1); assert.equal(receipt.queuePending,false);
  const record = await db.productRecord.findUniqueOrThrow({ where: { id: receipt.productId } });
  assert.equal(record.workspaceId,workspaceId); assert.equal(record.organizationId,org);
  assert.equal((record.payload as unknown as { selectionPipeline: { draftId: string } }).selectionPipeline.draftId,item.draft.product.id);
  assert.equal(await db.auditLog.count({ where: { organizationId: org, entityId: receipt.sku } }),1);
  assert.equal(await db.dataChangeVersion.count({ where: { organizationId: org, entityId: receipt.sku } }),1);
  assert.equal(await db.productOutboxEvent.count({ where: { organizationId: org, OR: [{ entityId: receipt.productId },{ entityId: receipt.sku }], status: "done" } }),2);
  assert.equal(await db.productSummaryRecord.count({ where: { organizationId: org, workspaceId, sku: receipt.sku } }),1);
  assert.equal(await db.productTextRecord.count({ where: { productRecordId: receipt.productId } }),1);
  const workspace = await db.workspaceScope.findUniqueOrThrow({ where: { organizationId_id: { organizationId: org,id: workspaceId } } });
  assert.equal(workspace.accountId,"preserve-account"); assert.equal(workspace.marketplace,"US");
  const created = await readJson<Receipt & { slug: string; workspaceId: string; createdAt: string; uploadedImageFileIds: string[] }>(path.join(item.dir,"derived/created.json"));
  assert.equal(created.productId,receipt.productId);
  assert.equal(created.slug,item.slug); assert.equal(created.workspaceId,workspaceId);
  assert.ok(Number.isFinite(Date.parse(created.createdAt))); assert.deepEqual(created.uploadedImageFileIds,[]);
});
test("same draft replay returns one immutable product and does not duplicate audit",async () => {
  const item = await prepare(); const first = await create(item); const second = await create(item);
  assert.equal(first.productId,second.productId); assert.equal(first.sku,second.sku); assert.equal(second.revision,1);
  assert.equal(await db.auditLog.count({ where: { organizationId: org,entityId: first.sku } }),1);
  await assert.rejects(create(item,owner,"other-workspace"),error => String((error as { stdout?: string }).stdout).includes("DRAFT_ID_SCOPE_CONFLICT"));
});
test("independent CLI processes allocate distinct SKUs under contention",async () => {
  const items = await Promise.all([prepare(),prepare()]);
  const receipts = await Promise.all(items.map(item => create(item)));
  assert.equal(new Set(receipts.map(r => r.sku)).size,2);
});
test("viewer and disabled owner are rejected before any aggregate changes",async () => {
  const item = await prepare(); const count = await db.productRecord.count();
  await assert.rejects(create(item,viewer)); assert.equal(await db.productRecord.count(),count);
  await db.user.update({ where: { id: owner }, data: { status: "disabled" } });
  try { await assert.rejects(create(item)); assert.equal(await db.productRecord.count(),count); }
  finally { await db.user.update({ where: { id: owner }, data: { status: "active" } }); }
});
test("cross-organization attachment fails and rolls back product/audit/outbox",async () => {
  const item = await prepare(); const file = await db.fileObject.create({ data: { organizationId: "other-org",userId: owner,workspaceId,originalName: "test.jpg",storageKey: "test-not-an-upload",mimeType: "image/jpeg",storageType: "local" } });
  item.draft.product.imageFileId = file.id;
  await writeJson(path.join(item.dir,"derived/draft.json"),item.draft);
  const counts = await Promise.all([db.productRecord.count(),db.auditLog.count(),db.productOutboxEvent.count()]);
  await assert.rejects(create(item));
  assert.deepEqual(await Promise.all([db.productRecord.count(),db.auditLog.count(),db.productOutboxEvent.count()]),counts);
});
test("same-draft concurrent processes converge even after separate artifact staging",async () => {
  const a = await prepare(); const b = await prepare(); b.draft.product.id = a.draft.product.id;
  await writeJson(path.join(b.dir,"derived/draft.json"),b.draft);
  const receipts = await Promise.all([create(a),create(b)]);
  assert.equal(receipts[0].productId,receipts[1].productId);
});
test("future outbox retry reports pending and a replay recovers durable events",async () => {
  const item = await prepare(); const first = await create(item);
  await db.productOutboxEvent.updateMany({ where: { organizationId: org,entityId: first.productId,eventType: "product_projection_requested" }, data: { status: "queued",availableAt: new Date(Date.now()+60000) } });
  const pending = await create(item); assert.equal(pending.queuePending,true);
  await db.productOutboxEvent.updateMany({ where: { organizationId: org,entityId: first.productId,eventType: "product_projection_requested" }, data: { availableAt: new Date(Date.now()-1000) } });
  const recovered = await create(item); assert.equal(recovered.queuePending,false); assert.equal(recovered.productId,first.productId);
});
