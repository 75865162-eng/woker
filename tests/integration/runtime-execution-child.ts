// Only launched by the disposable runtime integration test, never a registered production Worker.
import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import { createRequire } from "node:module";
import { processImportJob } from "../../src/lib/jobs/processor";
import { processImageUpscaleJob } from "../../src/lib/image-upscale/processor";
import { getStorageDriver } from "../../src/lib/storage";

assert.equal(process.env.ERP_RUNTIME_EXECUTION_FIXTURE, "1");
assert.equal(new URL(process.env.DATABASE_URL!).pathname, "/erp_fixture");
assert.ok(process.send, "fixture IPC required");
function workGate(): never {
  process.send!("work-gate");
  // Bounded by the parent's timeout/SIGKILL; models a synchronous CPU stage that cannot renew its lease.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) pbkdf2Sync("fixture", "fixture", 100_000, 32, "sha256");
  throw new Error("fixture was not killed at work gate");
}
const [, , kind, jobId] = process.argv;
async function main() {
if (kind === "bulk") {
  // Instrument the real XLSX parser boundary; do not replace its computation or delay it.
  const xlsx = createRequire(import.meta.url)("xlsx");
  const read = xlsx.read;
  xlsx.read = (...args: unknown[]) => {
    process.send!("bulk-read-start");
    const result = read(...args);
    process.send!("bulk-read-finished");
    return result;
  };
  await processImportJob(jobId);
} else if (kind === "import") {
  const storage = getStorageDriver(), put = storage.putBuffer.bind(storage);
  storage.putBuffer = async input => {
    await put(input);
    // Actual Excel serialization has finished; exercise death before database publication.
    return workGate();
  };
  await processImportJob(jobId);
} else {
  assert.equal(kind, "image-upscale");
  await processImageUpscaleJob(jobId, async () => workGate());
}
}
void main().catch(error => { console.error(error); process.exit(1); });
