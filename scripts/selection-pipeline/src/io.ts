import { appendFile, mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
export async function readJson<T>(file: string): Promise<T> { return JSON.parse(await readFile(file, "utf8")) as T; }
export async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n");
  await rename(temporary, file);
}
export function log(event: string, details: Record<string, unknown> = {}) { console.log(JSON.stringify({ at: new Date().toISOString(), event, ...details })); }
export async function recordError(dir: string, stage: string, error: unknown, asin?: string) {
  // Do not log command stdout, cookies, hook URLs or arbitrary response bodies.
  const code = error instanceof Error ? error.name : "UnknownError";
  const entry = { at: new Date().toISOString(), stage, asin, code };
  log("stage_failed", entry);
  await mkdir(path.join(dir, "raw"), { recursive: true });
  await appendFile(path.join(dir, "raw/errors.log"), JSON.stringify(entry) + "\n");
}
export class PipelineError extends Error {
  constructor(code: string) { super(code); this.name = code; }
}
