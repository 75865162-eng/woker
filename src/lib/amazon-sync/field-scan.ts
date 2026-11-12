import { createHash } from "node:crypto";
import { observedJsonFields, type ObservedFieldInventory } from "./raw-fields";
import { readTsv } from "./domain-reports";

export const fieldScannerVersion = "observed-fields.v1";
export function fieldIdentity(provider: string, sourceCode: string, apiVersion: string, path: string) {
  return `l0.${createHash("sha256").update(JSON.stringify([provider, sourceCode, apiVersion, path])).digest("hex")}`;
}

/** Inventory only: no numeric conversion, inferred nulls or samples. TSV cells
 * are strings, including empty strings; they are not explicit JSON nulls. */
export function scanArchivedFields(text: string, format: "JSON" | "REPORT"): ObservedFieldInventory & { emptyStrings: Record<string, number> } {
  const json = observedJsonFields(text);
  if (json.format === "json" || format === "JSON") return { ...json, emptyStrings: {} };
  const emptyStrings: Record<string, number> = Object.create(null);
  let fields: ObservedFieldInventory["fields"] = [], complete = true;
  try {
    const iterator = readTsv(text, { ledgerInteriorQuotes: true }), first = iterator.next();
    if (first.done || !first.value.length || new Set(first.value).size !== first.value.length) throw new Error("INVALID_HEADERS");
    fields = first.value.map(header => ({ path: `/columns/${header.replace(/~/g, "~0").replace(/\//g, "~1")}`, types: ["string"], observations: 0, nulls: 0 }));
    let rows = 0;
    for (const cells of iterator) {
      if (++rows > 50000 || cells.length !== fields.length) { complete = false; break; }
      cells.forEach((value, index) => { const field = fields[index]; field.observations!++; if (value === "") emptyStrings[field.path] = (emptyStrings[field.path] ?? 0) + 1; });
    }
  } catch { complete = false; }
  return { version: 1, schemaSource: "OBSERVED_RESPONSE", officialSchemaVersion: null,
    format: fields.length ? "tsv" : "text", complete, schemaHash: createHash("sha256").update(JSON.stringify(fields.map(field => field.path))).digest("hex"), fields, emptyStrings };
}
