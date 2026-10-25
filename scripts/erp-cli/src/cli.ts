import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { normalizeDraft } from "./schema";
import { getProduct, runUpsert } from "./service";
import { prisma } from "@/lib/db/prisma";

// Libraries may log during projection handling. stdout is reserved for the result.
console.log = console.error;
console.info = console.error;

function output(value: unknown) { process.stdout.write(`${JSON.stringify(value)}\n`); }
let commandSku = "";
let commandDryRun = !process.argv.includes("--write");
function fail(sku: string, error: unknown, dryRun = false) {
  const message = safeError(error);
  output({ ok: false, dryRun, sku, errors: [message], warnings: [] });
  process.exitCode = 1;
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.name === "ProductRecordRevisionConflictError") return "REVISION_CONFLICT: load latest product before retrying";
  if (error instanceof Error && error.name === "InvalidProductStatusError") return "INVALID_STATUS_TRANSITION";
  if (error && typeof error === "object" && "code" in error && String(error.code).startsWith("ERR_PARSE_ARGS")) return "INVALID_ARGUMENT: unknown or malformed command arguments";
  // Never expose Prisma diagnostics, connection strings, query arguments or secrets.
  const known = /^(UNAUTHORIZED|FORBIDDEN|WORKSPACE_[A-Z_]+|REVISION_CONFLICT|PRODUCT_ID_CONFLICT|CONCLUSION_EXCEL_REQUIRED|USAGE|INVALID_JSON|INVALID_ARGUMENT|INPUT_TOO_LARGE)/;
  return known.test(message) ? message : "ERP_OPERATION_FAILED: check database availability, product references and status transition";
}

async function inputJson(file?: string) {
  const limit = 8 * 1024 * 1024;
  const source = !file || file === "-" ? await new Promise<string>((resolve, reject) => { let text = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (chunk) => { text += chunk; if (Buffer.byteLength(text) > limit) { process.stdin.destroy(); reject(new Error("INPUT_TOO_LARGE")); } }); process.stdin.on("end", () => resolve(text)); process.stdin.on("error", reject); }) : await readFile(file, "utf8");
  if (Buffer.byteLength(source) > limit) throw new Error("INPUT_TOO_LARGE");
  try { return JSON.parse(source) as unknown; } catch { throw new Error("INVALID_JSON: input is not valid JSON"); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  const parsed = parseArgs({ args, allowPositionals: true, options: { file: { type: "string" }, write: { type: "boolean", default: false }, sku: { type: "string" }, workspace: { type: "string" } } });
  const [resource, command] = parsed.positionals;
  if (command === "get") commandDryRun = false;
  if (resource !== "products" || !["upsert", "get"].includes(command ?? "")) throw new Error("USAGE: erp products upsert --file draft.json [--write] | erp products get --sku SKU --workspace WORKSPACE");
  if (parsed.positionals.length !== 2 || (command === "get" && (parsed.values.write || parsed.values.file)) || (command === "upsert" && (parsed.values.sku || parsed.values.workspace))) throw new Error("INVALID_ARGUMENT: unexpected arguments for command");
  if (command === "get") {
    const sku = parsed.values.sku?.trim(); const workspace = parsed.values.workspace?.trim() || "default";
    commandSku = sku ?? "";
    if (!sku) throw new Error("INVALID_ARGUMENT: --sku is required");
    const result = await getProduct(sku, workspace);
    output(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const raw = await inputJson(parsed.values.file);
  const normalized = normalizeDraft(raw);
  if (!normalized.draft) { output({ ok: false, dryRun: !parsed.values.write, sku: typeof raw === "object" && raw ? String((raw as Record<string, unknown>).sku ?? "") : "", errors: normalized.errors, warnings: [] }); process.exitCode = 1; return; }
  try { output(await runUpsert(normalized.draft, !parsed.values.write)); }
  catch (error) { fail(normalized.draft.sku, error, !parsed.values.write); }
}

main().catch((error) => fail(commandSku, error, commandDryRun))
  .finally(async () => { if (process.env.DATABASE_URL) await prisma.$disconnect(); });
