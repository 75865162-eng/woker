import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { prisma } from "../../src/lib/db/prisma";
import { claimExecution, recoverExpiredExecutions, ExecutionLostError } from "../../src/lib/runtime/job-execution";
import { processImportJob } from "../../src/lib/jobs/processor";
import { processImageUpscaleJob } from "../../src/lib/image-upscale/processor";
import { getStorageDriver } from "../../src/lib/storage";

assert.equal(process.env.ERP_RUNTIME_EXECUTION_FIXTURE, "1", "Disposable fixture runner required");
after(() => prisma.$disconnect());
const base = { organizationId: "fixture-org", userId: "fixture-user" };
async function image() {
  return prisma.imageUpscaleJob.create({ data: { ...base, batchId: randomUUID(), originalName: "fixture.png", mimeType: "image/png", inputKey: "fixture-input.png", scale: 2, imageKind: "product", noiseLevel: "low", model: "fixture", inputSize: 4 } });
}
async function productExport() {
  const file = await prisma.fileObject.create({ data: { ...base, originalName: "fixture.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 0, storageKey: `fixture/${randomUUID()}.xlsx`, storageType: "local", status: "uploaded" } });
  const job = await prisma.importJob.create({ data: { ...base, fileId: file.id, type: "product_export" } });
  return { file, job };
}

test("duplicate claim, expiry takeover and late executor cannot publish", async () => {
  const job = await image();
  const claims = await Promise.all([claimExecution("image-upscale", job.id), claimExecution("image-upscale", job.id)]);
  const old = claims.find(Boolean)!;
  assert.equal(claims.filter(Boolean).length, 1);
  try {
    await prisma.imageUpscaleJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(0) } });
    await assert.rejects(old.write(tx => tx.imageUpscaleJob.update({ where: { id: job.id }, data: { outputKey: "stale" } })), ExecutionLostError);
    assert.equal(await recoverExpiredExecutions("image-upscale"), 1);
    const next = (await claimExecution("image-upscale", job.id))!;
    try {
      assert.notEqual(old.token, next.token);
      await next.write(tx => tx.imageUpscaleJob.update({ where: { id: job.id }, data: { status: "completed", outputKey: "new", leaseExpiresAt: null } }));
      await assert.rejects(old.write(tx => tx.imageUpscaleJob.update({ where: { id: job.id }, data: { status: "failed" } })), ExecutionLostError);
      assert.equal((await prisma.imageUpscaleJob.findUniqueOrThrow({ where: { id: job.id } })).outputKey, "new");
    } finally { next.dispose(); }
  } finally { old.dispose(); }
});

test("retry limit and legacy running rows remain safe", async () => {
  const job = await image(), legacy = await image();
  await prisma.imageUpscaleJob.update({ where: { id: legacy.id }, data: { status: "running", leaseExpiresAt: new Date(0) } });
  await prisma.imageUpscaleJob.update({ where: { id: job.id }, data: { maxAttempts: 1 } });
  const owner = (await claimExecution("image-upscale", job.id))!;
  try {
    await prisma.imageUpscaleJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(0) } });
    await recoverExpiredExecutions("image-upscale");
    assert.equal(await claimExecution("image-upscale", job.id), null);
    assert.equal((await prisma.imageUpscaleJob.findUniqueOrThrow({ where: { id: job.id } })).status, "failed");
    assert.equal((await prisma.imageUpscaleJob.findUniqueOrThrow({ where: { id: legacy.id } })).status, "running");
  } finally { owner.dispose(); }
});

test("publication and associated data roll back together", async () => {
  const job = await image(), owner = (await claimExecution("image-upscale", job.id))!;
  try {
    await assert.rejects(owner.write(async tx => {
      await tx.imageUpscaleJob.update({ where: { id: job.id }, data: { status: "completed", outputKey: "rolled-back" } });
      throw new Error("fixture publication failure");
    }), /fixture publication failure/);
    assert.equal((await prisma.imageUpscaleJob.findUniqueOrThrow({ where: { id: job.id } })).outputKey, null);
  } finally { owner.dispose(); }
});

test("image processor publishes unique attempt output with a mock local engine", async () => {
  const job = await image();
  await processImageUpscaleJob(job.id, async input => {
    assert.ok(input.outputKey.startsWith(`image-upscale/results/${job.id}/`));
    assert.ok(input.outputKey.endsWith(".png"));
    await getStorageDriver().putBuffer({ key: input.outputKey, buffer: Buffer.from("fixture"), contentType: "image/png" });
    return { model: "fixture", inputWidth: 1, inputHeight: 1, outputWidth: 2, outputHeight: 2, outputSize: 7, processingMs: 1 };
  });
  const result = await prisma.imageUpscaleJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(result.status, "completed");
  assert.equal(result.leaseExpiresAt, null);
  assert.equal((await getStorageDriver().getBuffer(result.outputKey!)).toString(), "fixture");
});

test("product export completes with file, export record and audit in one publication", async () => {
  const { file, job } = await productExport();
  await processImportJob(job.id);
  const result = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id }, include: { file: true, exportRecords: true } });
  assert.equal(result.status, "done");
  assert.equal(result.exportRecords.length, 1);
  assert.equal(result.file.storageKey, result.resultKey);
  assert.notEqual(result.resultKey, file.storageKey);
  assert.ok((await getStorageDriver().getBuffer(result.resultKey!)).byteLength > 0);
  assert.equal(await prisma.auditLog.count({ where: { entityId: job.id, action: "import_job_done" } }), 1);
});

test("import stale executor cannot publish its file, export or success audit after takeover", async t => {
  const { file, job } = await productExport();
  const storage = getStorageDriver(), put = storage.putBuffer.bind(storage);
  let release!: () => void, reached!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { reached = resolve; });
  let staleKey = "";
  const mock = t.mock.method(storage, "putBuffer", async (input: Parameters<typeof put>[0]) => {
    const result = await put(input);
    if (!staleKey) { staleKey = input.key; reached(); await held; }
    return result;
  });
  const stale = processImportJob(job.id);
  try {
    await Promise.race([ready, stale.then(() => { throw new Error("processor did not reach storage gate"); })]);
    const first = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });
    await prisma.importJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(0) } });
    await recoverExpiredExecutions("import");
    await processImportJob(job.id);
    const winner = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id }, include: { file: true } });
    assert.equal(winner.status, "done");
    assert.notEqual(winner.executionToken, first.executionToken);
    assert.notEqual(winner.resultKey, staleKey);
    assert.equal(winner.file.storageKey, winner.resultKey);
    release(); await stale;
    const after = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id }, include: { file: true, exportRecords: true } });
    assert.equal(after.resultKey, winner.resultKey);
    assert.equal(after.file.storageKey, winner.resultKey);
    assert.notEqual(after.file.storageKey, file.storageKey);
    assert.equal(after.exportRecords.length, 1);
    assert.equal(after.exportRecords[0].resultKey, winner.resultKey);
    assert.equal(await prisma.auditLog.count({ where: { entityId: job.id, action: "import_job_done" } }), 1);
    assert.equal(await prisma.dataChangeVersion.count({ where: { entityId: job.id, action: "import_job_done" } }), 1);
    assert.ok((await storage.getBuffer(staleKey)).length > 0, "unreferenced attempt file is retained, not automatically deleted");
  } finally { release(); await stale; mock.mock.restore(); }
});

test("import publication audit failure rolls back file, export, job and success versions", async () => {
  const { file, job } = await productExport();
  // Disposable database only: fail at the last audit, after all other publication writes.
  await prisma.$executeRawUnsafe(`CREATE FUNCTION fixture_reject_export_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action = 'export_record_save' THEN RAISE EXCEPTION 'fixture final audit failure'; END IF;
    RETURN NEW; END $$`);
  try {
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fixture_export_audit BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION fixture_reject_export_audit()`);
    await processImportJob(job.id);
    const result = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id }, include: { file: true, exportRecords: true } });
    assert.equal(result.status, "failed");
    assert.equal(result.resultKey, null);
    assert.equal(result.file.storageKey, file.storageKey);
    assert.equal(result.file.size, 0);
    assert.equal(result.exportRecords.length, 0);
    assert.equal(await prisma.auditLog.count({ where: { entityId: job.id, action: "import_job_done" } }), 0);
    assert.equal(await prisma.dataChangeVersion.count({ where: { entityId: job.id, action: "import_job_done" } }), 0);
    assert.equal(await prisma.dataChangeVersion.count({ where: { entityType: "export_record", entityId: { startsWith: job.id + ":" } } }), 0);
    assert.equal(await prisma.auditLog.count({ where: { entityId: job.id, action: "import_job_failed" } }), 1);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fixture_export_audit ON "AuditLog"');
    await prisma.$executeRawUnsafe("DROP FUNCTION fixture_reject_export_audit()");
  }
  await processImportJob(job.id);
  assert.equal((await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })).status, "done");
  assert.equal(await prisma.exportRecord.count({ where: { jobId: job.id } }), 1);
});

for (const kind of ["import", "image-upscale"] as const) {
  test(`${kind} processor SIGKILL at mock work gate recovers with one published result`, { timeout: 45_000 }, async () => {
    const job = kind === "import" ? (await productExport()).job : await image();
    // Same sanitized fixture environment as this test; child adds no dotenv loader or external engine.
    const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./runtime-execution-child.ts", import.meta.url)), kind, job.id], {
      env: process.env, stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let stderr = "";
    child.stderr!.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
    const exited = once(child, "exit");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const ready = new Promise<void>((resolve, reject) => {
        child.once("message", message => message === "work-gate" ? resolve() : reject(new Error("unexpected fixture message")));
        child.once("error", reject);
        child.once("exit", () => reject(new Error(`fixture exited before work gate: ${stderr}`)));
        timer = setTimeout(() => reject(new Error(`fixture work gate timeout: ${stderr}`)), 20_000);
      });
      await ready; clearTimeout(timer);
      child.kill("SIGKILL");
      assert.equal((await exited)[1], "SIGKILL");
      const table = kind === "import" ? '"ImportJob"' : '"ImageUpscaleJob"';
      const before = await prisma.$queryRawUnsafe<Array<{ status: string; executionToken: string }>>(`SELECT status, "executionToken" FROM ${table} WHERE id=$1`, job.id);
      assert.equal(before[0].status, "running");
      await prisma.$executeRawUnsafe(`UPDATE ${table} SET "leaseExpiresAt" = timestamp '1970-01-01' WHERE id=$1`, job.id);
      await recoverExpiredExecutions(kind);
      if (kind === "import") {
        await processImportJob(job.id);
        const result = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id }, include: { exportRecords: true } });
        assert.equal(result.status, "done"); assert.notEqual(result.executionToken, before[0].executionToken);
        assert.equal(result.executionAttempts, 2); assert.equal(result.exportRecords.length, 1);
        assert.equal(await prisma.auditLog.count({ where: { entityId: job.id, action: "import_job_done" } }), 1);
      } else {
        await processImageUpscaleJob(job.id, async input => {
          await getStorageDriver().putBuffer({ key: input.outputKey, buffer: Buffer.from("recovered"), contentType: "image/png" });
          return { model: "fixture", inputWidth: 1, inputHeight: 1, outputWidth: 2, outputHeight: 2, outputSize: 9, processingMs: 1 };
        });
        const result = await prisma.imageUpscaleJob.findUniqueOrThrow({ where: { id: job.id } });
        assert.equal(result.status, "completed"); assert.notEqual(result.executionToken, before[0].executionToken);
        assert.equal(result.executionAttempts, 2);
        assert.equal((await getStorageDriver().getBuffer(result.outputKey!)).toString(), "recovered");
      }
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
    }
  });
}
