import { compareResponseSchema } from "./official-schema";
import { createHash } from "node:crypto";
import { readTsv } from "./domain-reports";

type Field = { path: string; types: string[]; observations: number | null; nulls: number | null };
export type ObservedFieldInventory = {
  version: 1; schemaSource: "OBSERVED_RESPONSE"; officialSchemaVersion: null;
  format: "json" | "tsv" | "text"; complete: boolean; schemaHash: string;
  fields: Field[];
};

/** Field names can themselves contain sensitive dynamic keys. The inventory is
 * stored INSIDE the encrypted raw envelope, never in public request metadata.
 * Original bytes are always preserved, even when structural inspection is bounded.
 * Observed shape is not represented as the official Amazon schema or coverage.
 */
export function observedJsonFields(raw: string): ObservedFieldInventory {
  const fields = new Map<string, Field & { observations: number; nulls: number }>();
  let complete = true, visits = 0;
  const visit = (value: unknown, path: string, depth: number): void => {
    if (++visits > 200_000 || depth > 32 || path.length > 2048 || fields.size >= 4096 && !fields.has(path)) { complete = false; return; }
    const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    const entry = fields.get(path) ?? { path, types: [], observations: 0, nulls: 0 };
    if (!entry.types.includes(type)) entry.types.push(type);
    entry.observations++; if (value === null) entry.nulls++;
    fields.set(path, entry);
    if (Array.isArray(value)) {
      for (const item of value) { if (visits > 200_000) { complete = false; break; } visit(item, `${path}/*`, depth + 1); }
    } else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (visits > 200_000) { complete = false; break; }
        visit(child, `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, depth + 1);
      }
    }
  };
  let format: "json" | "text" = "json";
  try { visit(JSON.parse(raw), "", 0); } catch { complete = false; format = "text"; }
  const ordered = [...fields.values()].sort((a, b) => a.path.localeCompare(b.path)).map(field => ({ ...field, types: field.types.sort() }));
  const schemaHash = createHash("sha256").update(JSON.stringify(ordered.map(({ path, types }) => ({ path, types })))).digest("hex");
  return { version: 1, schemaSource: "OBSERVED_RESPONSE", officialSchemaVersion: null, format, complete, schemaHash, fields: ordered };
}

export function rawResponseEnvelope(rawBody: string, operation?: string, apiVersion?: string) {
  const fieldInventory = observedJsonFields(rawBody);
  return { rawBody, fieldInventory, registeredContract: compareResponseSchema(operation, apiVersion, fieldInventory.fields, fieldInventory.complete) };
}

export function rawReportEnvelope(rawText: string) {
  let fieldInventory = observedJsonFields(rawText);
  if (fieldInventory.format === "text" && rawText.includes("\t")) {
    try {
      const first = readTsv(rawText).next();
      const headers = first.value as string[] | undefined;
      if (!first.done && headers?.length && headers.length <= 100) {
        const fields = headers.map(path => ({ path, types: ["string"], observations: null, nulls: null }));
        fieldInventory = { version: 1, schemaSource: "OBSERVED_RESPONSE", officialSchemaVersion: null, format: "tsv", complete: true, schemaHash: createHash("sha256").update(JSON.stringify(headers)).digest("hex"), fields };
      }
    } catch { /* Raw text is still archived when metadata inspection is incomplete. */ }
  }
  return { rawText, fieldInventory };
}
