// Invoked only with the disposable runner's allowlisted environment and newly created container.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";
import sharp from "sharp";
import { prisma } from "../../src/lib/db/prisma";
import { processImportJob } from "../../src/lib/jobs/processor";
import { processImageUpscaleJob } from "../../src/lib/image-upscale/processor";
import { recoverExpiredExecutions } from "../../src/lib/runtime/job-execution";
import { getStorageDriver } from "../../src/lib/storage";

assert.equal(process.env.ERP_RUNTIME_EXECUTION_FIXTURE, "1");
const target = new URL(process.env.DATABASE_URL!);
assert.equal(target.hostname, "127.0.0.1");
assert.equal(target.pathname, "/erp_fixture");
const pgContainer = process.env.ERP_RUNTIME_FIXTURE_PG_CONTAINER!;
assert.match(pgContainer, /^erp-runtime-pg-[a-f0-9]{8}$/);
after(() => prisma.$disconnect());
const require = createRequire(import.meta.url), { Client } = require("pg");
const execute = promisify(execFile);
const base = { organizationId: "fixture-org", userId: "fixture-user" };
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn: () => Promise<unknown>, label: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { if (await fn()) return; } catch { /* Only the fixture database is restarting. */ }
    await pause(100);
  }
  throw new Error(`Fixture timeout: ${label}`);
}
async function importJob(type: string, buffer?: Buffer) {
  const key = `fixture/${randomUUID()}.xlsx`;
  if (buffer) await getStorageDriver().putBuffer({ key, buffer, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const file = await prisma.fileObject.create({ data: { ...base, originalName: "fixture.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: buffer?.length ?? 0, storageKey: key, storageType: "local", status: "uploaded" } });
  const job = await prisma.importJob.create({ data: { ...base, fileId: file.id, type } });
  return { file, job };
}

test("SIGKILL during real XLSX read preserves Bulk input and resumes to one export", { timeout: 90_000 }, async () => {
  const workbook = XLSX.utils.book_new();
  const row = { Entity: "Keyword", Operation: "", "Campaign ID": "fixture-campaign", "Ad Group ID": "fixture-group", "Keyword ID": "fixture-keyword", "Campaign Name (Informational only)": "Fixture Campaign", "Ad Group Name (Informational only)": "Fixture Group", "Keyword Text": "fixture keyword", "Match Type": "exact", Bid: 1, Impressions: 1000, Clicks: 30, Spend: 30, Sales: 0, Orders: 0, State: "enabled" };
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([row]), "Sponsored Products Campaigns");
  // A bounded synthetic auxiliary sheet makes XLSX.read observable without artificial sleeps inside it.
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["fixture-index", "fixture-value"], ...Array.from({ length: 80_000 }, (_, i) => [i, `fixture-${i}`]),
  ]), "Fixture Auxiliary");
  const input = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const { file, job } = await importJob("bulk", input);
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./runtime-execution-child.ts", import.meta.url)), "bulk", job.id], {
    env: process.env, stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const exited = once(child, "exit");
  let finished = false, stderr = "";
  child.stderr!.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
  child.on("message", value => { if (value === "bulk-read-finished") finished = true; });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("message", value => value === "bulk-read-start" ? resolve() : reject(new Error("Unexpected parser signal")));
      child.once("error", reject);
      child.once("exit", () => reject(new Error(`Parser exited before start: ${stderr}`)));
      timer = setTimeout(() => reject(new Error(`No parser start: ${stderr}`)), 20_000);
    });
    clearTimeout(timer);
    await pause(25);
    assert.equal(finished, false, "parser must still be computing, not at a post-parse gate");
    child.kill("SIGKILL");
    assert.equal((await exited)[1], "SIGKILL");
    assert.equal(finished, false);
    const interrupted = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(interrupted.status, "running"); assert.equal(interrupted.resultKey, null);
    assert.equal(await prisma.exportRecord.count({ where: { jobId: job.id } }), 0);
    assert.deepEqual(await getStorageDriver().getBuffer(file.storageKey), input);
    await prisma.importJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(0) } });
    await recoverExpiredExecutions("import");
    await processImportJob(job.id);
    const result = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id }, include: { file: true, exportRecords: true } });
    assert.equal(result.status, "done", result.error ?? "Bulk recovery failed");
    assert.notEqual(result.executionToken, interrupted.executionToken); assert.equal(result.executionAttempts, 2);
    assert.equal(result.file.storageKey, file.storageKey, "Bulk original workbook must be immutable");
    assert.deepEqual(await getStorageDriver().getBuffer(file.storageKey), input);
    assert.equal(result.exportRecords.length, 1);
    assert.equal(await prisma.auditLog.count({ where: { entityId: job.id, action: "import_job_done" } }), 1);
    assert.ok((await getStorageDriver().getBuffer(result.resultKey!)).length > 0);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  }
});

test("real image engine spawn handles executable SIGKILL without publishing a partial result", { timeout: 45_000 }, async () => {
  // Native Real-ESRGAN is not installed. Use an executable fixture with its exact -i/-o/-s protocol.
  const directory = path.join(process.env.UPLOAD_DIR!, `engine-fixture-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const executable = path.join(directory, "engine"), marker = path.join(directory, "marker.json");
  const code = `#!${process.execPath}
const fs = require('node:fs');
const assert = require('node:assert/strict');
assert.equal(process.env.ERP_RUNTIME_EXECUTION_FIXTURE, '1');
const args = process.argv.slice(2), value = name => args[args.indexOf(name) + 1];
async function main() {
  if (process.env.ERP_FIXTURE_ENGINE_MODE === 'kill') {
    fs.writeFileSync(value('-o'), Buffer.from('partial-fixture-output'));
    fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({pid:process.pid, output:value('-o')}));
    process.kill(process.pid, 'SIGKILL'); return;
  }
  const sharp = require(${JSON.stringify(require.resolve("sharp"))});
  await sharp(value('-i')).resize(2,2).png().toFile(value('-o'));
}
main().catch(() => process.exit(1));
`;
  await writeFile(executable, code, { mode: 0o700 });
  const previous = { binary: process.env.REALESRGAN_NCNN_EXE, mode: process.env.ERP_FIXTURE_ENGINE_MODE };
  process.env.REALESRGAN_NCNN_EXE = executable;
  process.env.ERP_FIXTURE_ENGINE_MODE = "kill";
  try {
    const inputKey = `fixture/${randomUUID()}.png`;
    const buffer = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } }).png().toBuffer();
    await getStorageDriver().putBuffer({ key: inputKey, buffer, contentType: "image/png" });
    const job = await prisma.imageUpscaleJob.create({ data: { ...base, batchId: randomUUID(), originalName: "fixture.png", mimeType: "image/png", inputKey, scale: 2, imageKind: "product", noiseLevel: "low", model: "fixture", inputSize: buffer.length } });
    await assert.rejects(processImageUpscaleJob(job.id), /Real-ESRGAN exited/);
    const markerValue = JSON.parse(await readFile(marker, "utf8"));
    assert.throws(() => process.kill(markerValue.pid, 0), (error: NodeJS.ErrnoException) => error.code === "ESRCH");
    await assert.rejects(readFile(markerValue.output), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
    const failed = await prisma.imageUpscaleJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(failed.status, "failed"); assert.equal(failed.outputKey, null); assert.equal(failed.leaseExpiresAt, null);
    process.env.ERP_FIXTURE_ENGINE_MODE = "success";
    await processImageUpscaleJob(job.id);
    const completed = await prisma.imageUpscaleJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(completed.status, "completed"); assert.equal(completed.executionAttempts, 2);
    const meta = await sharp(await getStorageDriver().getBuffer(completed.outputKey!)).metadata();
    assert.equal(meta.width, 2); assert.equal(meta.height, 2);
    assert.deepEqual(await getStorageDriver().getBuffer(inputKey), buffer);
  } finally {
    if (previous.binary === undefined) delete process.env.REALESRGAN_NCNN_EXE; else process.env.REALESRGAN_NCNN_EXE = previous.binary;
    if (previous.mode === undefined) delete process.env.ERP_FIXTURE_ENGINE_MODE; else process.env.ERP_FIXTURE_ENGINE_MODE = previous.mode;
    await rm(directory, { recursive: true, force: true });
  }
});

test("PostgreSQL restart inside final publication rolls back and permits one safe retry", { timeout: 90_000 }, async () => {
  const inspected = JSON.parse((await execute("docker", ["inspect", pgContainer])).stdout)[0];
  assert.equal(inspected.Config.Labels["codex.task"], "erp-runtime-fixture");
  assert.equal(inspected.NetworkSettings.Ports["5432/tcp"][0].HostIp, "127.0.0.1");
  assert.equal(inspected.NetworkSettings.Ports["5432/tcp"][0].HostPort, target.port);
  const { file, job } = await importJob("product_export");
  const key = 191810;
  const holder = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2000 });
  holder.on("error", () => {}); // The fixture restart deliberately disconnects this lock holder.
  await holder.connect();
  await holder.query("SELECT pg_advisory_lock($1::bigint)", [key]);
  await prisma.$executeRawUnsafe(`CREATE FUNCTION fixture_pause_final_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action = 'export_record_save' THEN PERFORM pg_advisory_xact_lock(${key}::bigint); END IF;
    RETURN NEW; END $$`);
  let processing: Promise<unknown> | undefined;
  try {
    await prisma.$executeRawUnsafe('CREATE TRIGGER fixture_pause_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fixture_pause_final_audit()');
    processing = processImportJob(job.id).then(() => ({ ok: true }), () => ({ ok: false }));
    await until(async () => {
      const rows = await prisma.$queryRawUnsafe<Array<{ waiting: boolean }>>(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=${key}::oid AND NOT granted) AS waiting`);
      return rows[0].waiting;
    }, "final audit blocked inside transaction");
    await execute("docker", ["restart", pgContainer]);
    await until(() => prisma.$queryRaw`SELECT 1`, "fixture PostgreSQL reconnect");
    await processing;
    const interrupted = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id }, include: { file: true, exportRecords: true } });
    assert.ok(["running", "failed"].includes(interrupted.status));
    assert.equal(interrupted.resultKey, null); assert.equal(interrupted.file.storageKey, file.storageKey);
    assert.equal(interrupted.file.size, 0); assert.equal(interrupted.exportRecords.length, 0);
    assert.equal(await prisma.auditLog.count({ where: { entityId: job.id, action: "import_job_done" } }), 0);
    assert.equal(await prisma.dataChangeVersion.count({ where: { entityId: job.id, action: "import_job_done" } }), 0);
    assert.equal(await prisma.dataChangeVersion.count({ where: { entityType: "export_record", entityId: { startsWith: job.id + ":" } } }), 0);
    // Remove the gate before testing the real processor's retry.
    await prisma.$executeRawUnsafe('DROP TRIGGER fixture_pause_audit ON "AuditLog"');
    if (interrupted.status === "running") {
      await prisma.importJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(0) } });
      await recoverExpiredExecutions("import");
    }
    await processImportJob(job.id);
    const result = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id }, include: { file: true, exportRecords: true } });
    assert.equal(result.status, "done"); assert.equal(result.executionAttempts, 2);
    assert.notEqual(result.executionToken, interrupted.executionToken);
    assert.equal(result.file.storageKey, result.resultKey); assert.equal(result.exportRecords.length, 1);
    assert.equal(await prisma.auditLog.count({ where: { entityId: job.id, action: "import_job_done" } }), 1);
  } finally {
    await holder.end().catch(() => {});
    if (processing) await processing;
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fixture_pause_audit ON "AuditLog"');
    await prisma.$executeRawUnsafe('DROP FUNCTION fixture_pause_final_audit()');
  }
});
