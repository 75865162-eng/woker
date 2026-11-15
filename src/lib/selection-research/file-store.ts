import { constants } from "node:fs";
import { mkdir, open, readFile, rename, rm, lstat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hostname, userInfo } from "node:os";
import path from "node:path";
import type { Run, Store } from "./types";

/**
 * POSIX ownership and mode bits are the only portable way to prove the store folder is private.
 * Windows does not report a meaningful uid through lstat() and ignores mkdir modes, so the
 * ownership/mode assertions are limited to POSIX. Directory-ness and symlink rejection still apply
 * on every platform.
 */
const enforcePosixOwnership = process.platform !== "win32";

/** Device-local CLI adapter only. ERP multi-user storage must use its authorized repository boundary. */
export class LocalResearchStore implements Store {
  constructor(readonly root: string) {}
  private folder(id: string) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error("INVALID_RUN_ID");
    return path.join(this.root, id);
  }
  private async check(folder: string) {
    const stat = await lstat(folder);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("UNSAFE_LOCAL_STORE");
    if (enforcePosixOwnership && (stat.uid !== userInfo().uid || (stat.mode & 0o077) !== 0)) throw new Error("UNSAFE_LOCAL_STORE");
  }
  async create(run: Run) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await this.check(this.root);
    const folder = this.folder(run.id);
    await mkdir(folder, { mode: 0o700 });
    await this.persist(folder, run);
  }
  async read(id: string): Promise<Run> {
    const folder = this.folder(id);
    await this.check(this.root); await this.check(folder);
    const handle = await open(path.join(folder, "state.json"), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const run = JSON.parse(await handle.readFile("utf8")) as Run;
      if (run.version !== 1 || run.id !== id) throw new Error("UNSUPPORTED_STATE");
      return run;
    } finally { await handle.close(); }
  }
  private async persist(folder: string, run: Run) {
    const temp = path.join(folder, `${randomUUID()}.tmp`);
    const handle = await open(temp, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(run)); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, path.join(folder, "state.json"));
    if (enforcePosixOwnership) {
      // Only POSIX filesystems allow fsync on a directory handle; Windows returns EPERM.
      const directory = await open(folder, "r");
      try { await directory.sync(); } finally { await directory.close(); }
    }
  }
  async transaction<T>(id: string, work: (run: Run, save: () => Promise<void>) => Promise<T>): Promise<T> {
    const folder = this.folder(id);
    await this.check(this.root); await this.check(folder);
    const lock = path.join(folder, ".lock");
    try { await mkdir(lock, { mode: 0o700 }); } catch { throw new Error("RUN_LOCKED_USE_EXPLICIT_RECOVERY"); }
    try {
      const owner = await open(path.join(lock, "owner.json"), "wx", 0o600);
      try { await owner.writeFile(JSON.stringify({ pid: process.pid, host: hostname() })); await owner.sync(); } finally { await owner.close(); }
      const run = await this.read(id);
      return await work(run, async () => { run.revision++; run.updatedAt = new Date().toISOString(); await this.persist(folder, run); });
    } finally { await rm(lock, { recursive: true, force: true }); }
  }
  /** Explicit local operator recovery only; never steal a live/remote/ambiguous lock. */
  async recoverDeadProcessLock(id: string) {
    const folder = this.folder(id);
    await this.check(this.root); await this.check(folder);
    const lock = path.join(folder, ".lock");
    const owner = JSON.parse(await readFile(path.join(lock, "owner.json"), "utf8")) as { pid: number; host: string };
    if (owner.host !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error("LOCK_OWNER_UNKNOWN");
    try { process.kill(owner.pid, 0); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") { await rm(lock, { recursive: true }); return; }
      throw new Error("LOCK_OWNER_UNKNOWN");
    }
    throw new Error("LOCK_OWNER_ALIVE");
  }
}
