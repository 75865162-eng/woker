import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, openSync, writeFileSync, readFileSync, closeSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Ports do not isolate Next manifests: every output directory needs one owner.
export function acquireNextOutputLock(distDirectory, { lockDirectory = path.join(tmpdir(), `erp-next-locks-${process.getuid?.() ?? "user"}`) } = {}) {
  mkdirSync(distDirectory, { recursive: true });
  const output = realpathSync(distDirectory);
  mkdirSync(lockDirectory, { recursive: true, mode: 0o700 });
  const key = createHash("sha256").update(output).digest("hex");
  const filename = path.join(lockDirectory, `${key}.lock`);
  let fd;
  try { fd = openSync(filename, "wx", 0o600); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    // Fail closed even for a dead owner: its Next child may still be running.
    throw new Error(`Next output is already locked: ${output}. Stop its owning Next process before retrying. If it crashed, verify no process uses this output before removing ${filename}.`);
  }
  const owner = JSON.stringify({ pid: process.pid, token: randomUUID(), output });
  try { writeFileSync(fd, owner); }
  catch (error) { closeSync(fd); unlinkSync(filename); throw error; }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    closeSync(fd);
    try { if (readFileSync(filename, "utf8") === owner) unlinkSync(filename); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  };
}
