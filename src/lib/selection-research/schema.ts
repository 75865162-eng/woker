import type { Json, ObjectJson } from "./types";

/** Ignore object key order only; preserve all values and array ordering. */
export function stableJson(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

const supported = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "const", "minimum", "maximum", "minItems", "maxItems", "minLength", "maxLength", "description", "title", "default", "$schema", "format", "anyOf", "allOf", "if", "then", "else", "dependentRequired", "pattern", "uniqueItems", "examples"]);
/** Deliberately small fail-closed JSON-schema subset. Unsupported constraints require review. */
export function validate(schema: ObjectJson | boolean, value: Json, at = "$", depth = 0, strictProperties = true): void {
  if (schema === false) throw new Error(`SCHEMA_FORBIDDEN:${at}`);
  if (schema === true) return;
  if (depth > 20) throw new Error("SCHEMA_DEPTH");
  for (const key of Object.keys(schema)) if (!supported.has(key)) throw new Error(`SCHEMA_UNSUPPORTED:${key}`);
  const matches = (branch: Json) => {
    if (typeof branch !== "boolean" && (!branch || typeof branch !== "object" || Array.isArray(branch))) throw new Error("SCHEMA_BRANCH_INVALID");
    try { validate(branch as ObjectJson | boolean, value, at, depth + 1, false); return true; }
    catch (error) { if (error instanceof Error && /UNSUPPORTED|DEPTH|BRANCH_INVALID/.test(error.message)) throw error; return false; }
  };
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some(matches)) throw new Error(`SCHEMA_ANY_OF:${at}`);
  if (Array.isArray(schema.allOf)) for (const branch of schema.allOf) validate(branch as ObjectJson, value, at, depth + 1, false);
  if (schema.if) {
    const branch = matches(schema.if) ? schema.then : schema.else;
    if (branch !== undefined) validate(branch as ObjectJson, value, at, depth + 1, false);
  }
  if (Array.isArray(schema.type)) {
    const types = schema.type;
    if (!types.length || types.some(type => !["object", "array", "string", "number", "integer", "boolean", "null"].includes(String(type)))) throw new Error("SCHEMA_TYPE_UNSUPPORTED");
    for (const type of types) {
      try { validate({ ...schema, type }, value, at, depth + 1, strictProperties); return; }
      catch (error) { if (error instanceof Error && /UNSUPPORTED|DEPTH/.test(error.message)) throw error; }
    }
    throw new Error(`SCHEMA_TYPE:${at}`);
  }
  const type = schema.type;
  if (type !== undefined && !["object", "array", "string", "number", "integer", "boolean", "null"].includes(String(type))) throw new Error("SCHEMA_TYPE_UNSUPPORTED");
  const object = value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "object" && !object || type === "array" && !Array.isArray(value) || type === "string" && typeof value !== "string" || type === "boolean" && typeof value !== "boolean" || type === "null" && value !== null || (type === "number" || type === "integer") && (typeof value !== "number" || !Number.isFinite(value) || type === "integer" && !Number.isSafeInteger(value))) throw new Error(`SCHEMA_TYPE:${at}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) throw new Error(`SCHEMA_ENUM:${at}`);
  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) throw new Error(`SCHEMA_CONST:${at}`);
  if (typeof value === "number" && (typeof schema.minimum === "number" && value < schema.minimum || typeof schema.maximum === "number" && value > schema.maximum)) throw new Error(`SCHEMA_RANGE:${at}`);
  if (typeof value === "string" && schema.format !== undefined) {
    if (schema.format !== "date") throw new Error("SCHEMA_FORMAT_UNSUPPORTED");
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`SCHEMA_DATE:${at}`);
  }
  if (typeof value === "string" && typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) throw new Error(`SCHEMA_PATTERN:${at}`);
  if (typeof value === "string" && (typeof schema.minLength === "number" && value.length < schema.minLength || typeof schema.maxLength === "number" && value.length > schema.maxLength)) throw new Error(`SCHEMA_LENGTH:${at}`);
  if (Array.isArray(value)) {
    if (schema.uniqueItems === true && new Set(value.map(item => JSON.stringify(item))).size !== value.length) throw new Error(`SCHEMA_UNIQUE_ITEMS:${at}`);
    if (typeof schema.minItems === "number" && value.length < schema.minItems || typeof schema.maxItems === "number" && value.length > schema.maxItems) throw new Error(`SCHEMA_ITEMS:${at}`);
    if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) value.forEach((item, i) => validate(schema.items as ObjectJson, item, `${at}[${i}]`, depth + 1));
  }
  if (object) {
    const values = value as ObjectJson;
    const properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties) ? schema.properties as ObjectJson : {};
    if (Array.isArray(schema.required)) for (const key of schema.required) if (typeof key === "string" && values[key] === undefined) throw new Error(`SCHEMA_REQUIRED:${at}.${key}`);
    if (schema.dependentRequired && typeof schema.dependentRequired === "object" && !Array.isArray(schema.dependentRequired)) {
      for (const [key, dependencies] of Object.entries(schema.dependentRequired)) if (Object.hasOwn(values, key) && Array.isArray(dependencies)) {
        for (const dependency of dependencies) if (typeof dependency === "string" && !Object.hasOwn(values, dependency)) throw new Error(`SCHEMA_REQUIRED:${at}.${dependency}`);
      }
    }
    for (const [key, child] of Object.entries(values)) {
      if (!Object.hasOwn(properties, key)) {
        if (strictProperties || schema.additionalProperties === false) throw new Error(`SCHEMA_UNKNOWN:${at}.${key}`);
        continue;
      }
      const spec = properties[key];
      if (spec === false) throw new Error(`SCHEMA_FORBIDDEN:${at}.${key}`);
      if (spec === true) continue;
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
