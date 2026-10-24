import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Competitor } from "../types";
const exec = promisify(execFile);
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
export class SnapshotStore {
  constructor(readonly file: string) {}
  async sql(sql: string) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const { stdout } = await exec("sqlite3", ["-cmd", ".timeout 5000", "-json", this.file, sql], { timeout: 10000, maxBuffer: 1024 * 1024 });
    return stdout;
  }
  async init() {
    await this.sql(`CREATE TABLE IF NOT EXISTS asin_snapshots (asin TEXT NOT NULL, capturedAt TEXT NOT NULL, price REAL, bsr INTEGER, reviewsCount INTEGER, rating REAL, PRIMARY KEY(asin,capturedAt));
      CREATE TABLE IF NOT EXISTS request_budget (day TEXT PRIMARY KEY, used INTEGER NOT NULL);`);
  }
  async reserve(budget: number) {
    // SQLite's write lock makes the quota shared across slugs/processes, including failed requests.
    const day = new Date().toISOString().slice(0,10);
    const out = await this.sql(`BEGIN IMMEDIATE; INSERT INTO request_budget VALUES (${quote(day)},0) ON CONFLICT DO NOTHING;
      UPDATE request_budget SET used=used+1 WHERE day=${quote(day)} AND used<${budget} RETURNING used; COMMIT;`);
    return out.trim().length > 0;
  }
  async capture(c: Competitor) {
    const num = (v: number | null | undefined) => typeof v === "number" && Number.isFinite(v) ? String(v) : "NULL";
    await this.sql(`INSERT OR IGNORE INTO asin_snapshots VALUES (${quote(c.asin)},${quote(c.capturedAt ?? new Date().toISOString())},${num(c.price)},${num(c.bsr)},${num(c.reviewsCount)},${num(c.rating)});`);
  }
}
