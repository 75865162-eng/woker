import type { Json, ObjectJson } from "./types";

const supported = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "const", "minimum", "maximum", "minItems", "maxItems", "minLength", "maxLength", "description", "title", "default", "$schema"]);
/** Deliberately small fail-closed JSON-schema subset. Unsupported constraints require review. */
export function validate(schema: ObjectJson, value: Json, at = "$", depth = 0): void {
  if (depth > 20) throw new Error("SCHEMA_DEPTH");
  for (const key of Object.keys(schema)) if (!supported.has(key)) throw new Error(`SCHEMA_UNSUPPORTED:${key}`);
  const type = schema.type;
  if (type !== undefined && !["object", "array", "string", "number", "integer", "boolean", "null"].includes(String(type))) throw new Error("SCHEMA_TYPE_UNSUPPORTED");
  const object = value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "object" && !object || type === "array" && !Array.isArray(value) || type === "string" && typeof value !== "string" || type === "boolean" && typeof value !== "boolean" || type === "null" && value !== null || (type === "number" || type === "integer") && (typeof value !== "number" || !Number.isFinite(value) || type === "integer" && !Number.isSafeInteger(value))) throw new Error(`SCHEMA_TYPE:${at}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) throw new Error(`SCHEMA_ENUM:${at}`);
  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) throw new Error(`SCHEMA_CONST:${at}`);
  if (typeof value === "number" && (typeof schema.minimum === "number" && value < schema.minimum || typeof schema.maximum === "number" && value > schema.maximum)) throw new Error(`SCHEMA_RANGE:${at}`);
  if (typeof value === "string" && (typeof schema.minLength === "number" && value.length < schema.minLength || typeof schema.maxLength === "number" && value.length > schema.maxLength)) throw new Error(`SCHEMA_LENGTH:${at}`);
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems || typeof schema.maxItems === "number" && value.length > schema.maxItems) throw new Error(`SCHEMA_ITEMS:${at}`);
    if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) value.forEach((item, i) => validate(schema.items as ObjectJson, item, `${at}[${i}]`, depth + 1));
  }
  if (object) {
    const values = value as ObjectJson;
    const properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties) ? schema.properties as ObjectJson : {};
    if (Array.isArray(schema.required)) for (const key of schema.required) if (typeof key === "string" && values[key] === undefined) throw new Error(`SCHEMA_REQUIRED:${at}.${key}`);
    for (const [key, child] of Object.entries(values)) {
      const spec = properties[key];
      // Reject undeclared arguments even when a provider has a permissive default.
      if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error(`SCHEMA_UNKNOWN:${at}.${key}`);
      validate(spec as ObjectJson, child, `${at}.${key}`, depth + 1);
    }
  }
}

export function rejectCredentials(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(rejectCredentials); return; }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (/^(?:authorization|cookie|password|secret[\w-]*|(?:api|access|refresh|mcp)[_-]?(?:key|token)|credentials|headers)$/i.test(key)) throw new Error("CREDENTIAL_FIELD_REJECTED");
      rejectCredentials(child);
    }
  }
  if (typeof value === "string" && (/\bBearer\s+\S+/i.test(value) || /[?&](?:api[_-]?key|token|secret|password)=/i.test(value))) throw new Error("CREDENTIAL_VALUE_REJECTED");
  if (typeof value === "string" && /^[\s]*[\[{]/.test(value)) {
    let parsed: unknown;
    try { parsed = JSON.parse(value); } catch { return; }
    rejectCredentials(parsed);
  }
}
