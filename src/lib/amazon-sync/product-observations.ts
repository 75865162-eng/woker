import listingModel from "@/data/amazon-contracts/listings-detail-model.json";
import catalogModel from "@/data/amazon-contracts/catalog-detail-model.json";
import { readFinanceJson, WireDecimal } from "./finance";
import { observationFact, type SafeFact } from "./observation-parsers";
import { observationInvalid as invalid, observationObject as object, type ListingDetailPolicy, type CatalogDetailPolicy } from "./observation-policy";

type Schema = { $ref?: string; type?: string; properties?: Record<string, Schema>; required?: string[]; items?: Schema; enum?: unknown[]; minimum?: number; maximum?: number; format?: string };
type Model = { definitions: Record<string, Schema> };
function string(value: unknown): string {
  if (typeof value !== "string" || value.length > 20_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return invalid();
  return value;
}
function array(value: unknown): unknown[] { return Array.isArray(value) && value.length <= 1000 ? value : invalid(); }
/** Official structure is the public field allowlist. Product text remains plain
 * text; image URLs are metadata only and are never fetched by this receiver. */
function project(value: unknown, schema: Schema, model: Model, depth = 0): unknown {
  if (depth > 24) return invalid();
  if (schema.$ref) {
    if (!schema.$ref.startsWith("#/definitions/")) return invalid();
    const child = model.definitions[schema.$ref.slice(14)];
    return child ? project(value, child, model, depth + 1) : invalid();
  }
  if (schema.type === "object") {
    const row = object(value), result: Record<string, unknown> = Object.create(null);
    for (const key of schema.required ?? []) if (row[key] === undefined) return invalid();
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (row[key] !== undefined) result[key] = project(row[key], child, model, depth + 1);
    return result;
  }
  if (schema.type === "array") return array(value).map(v => project(v, schema.items ?? {}, model, depth + 1));
  if (schema.type === "boolean") return typeof value === "boolean" ? value : invalid();
  if (schema.type === "integer" || schema.type === "number") {
    if (!(value instanceof WireDecimal) || !Number.isFinite(Number(value.source)) || Number(value.source) < (schema.minimum ?? -Number.MAX_VALUE) || Number(value.source) > (schema.maximum ?? Number.MAX_VALUE) || schema.type === "integer" && !Number.isSafeInteger(Number(value.source))) return invalid();
    return value.source;
  }
  if (schema.type === "string") {
    const result = string(value);
    if (schema.enum && !schema.enum.includes(result) || schema.format === "date-time" && !Number.isFinite(Date.parse(result))) return invalid();
    return result;
  }
  return invalid();
}
// Dynamic product-type attributes are not a license to expose contact, offer or
// inventory payloads. Unknown attributes stay in the encrypted original only.
export const productAttributeNames = ["item_name", "bullet_point", "product_description", "brand", "manufacturer", "model_name", "model_number", "part_number", "color", "size", "material", "style", "pattern", "item_shape", "item_type_keyword", "generic_keyword", "recommended_browse_nodes", "externally_assigned_product_identifier", "supplier_declared_has_product_identifier_exemption", "variation_theme", "parentage_level", "child_parent_sku_relationship", "item_package_dimensions", "item_dimensions", "item_package_weight", "item_weight", "number_of_items", "number_of_pieces", "unit_count", "country_of_origin", "included_components", "special_feature", "target_gender", "age_range_description", "care_instructions", "fabric_type", "department", "is_assembly_required", "batteries_required"] as const;
function attributes(value: unknown, marketplaceId: string) {
  const row = object(value), result: Record<string, unknown> = Object.create(null);
  let nodes = 0;
  function copy(value: unknown, depth = 0): unknown {
    if (++nodes > 20_000 || depth > 12) return invalid();
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") return string(value);
    if (value instanceof WireDecimal) return value.source;
    if (Array.isArray(value)) return array(value).map(v => copy(v, depth + 1));
    const record = object(value), output: Record<string, unknown> = Object.create(null);
    for (const [key, v] of Object.entries(record)) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(key) || /(?:secret|token|password|email|phone|address|contact)/i.test(key)) return invalid();
      if (key === "marketplace_id" && v !== marketplaceId) return invalid();
      output[key] = copy(v, depth + 1);
    }
    return output;
  }
  for (const key of productAttributeNames) if (Object.hasOwn(row, key)) {
    const entries = array(row[key]).filter(v => { const item = object(v); return item.marketplace_id === undefined || item.marketplace_id === marketplaceId; });
    result[key] = entries.map(v => copy(v));
  }
  return { attributes: result, excludedAttributeCount: Object.keys(row).filter(k => !(productAttributeNames as readonly string[]).includes(k)).length };
}
function scopedRoot(raw: string, marketplaceId: string, model: Model) {
  const root = object(readFinanceJson(raw));
  if (root.errors !== undefined && array(root.errors).length) return invalid();
  const scoped = { ...root };
  for (const key of Object.keys(model.definitions.Item.properties ?? {})) {
    if (["sku", "asin"].includes(key) || root[key] === undefined) continue;
    scoped[key] = array(root[key]).filter(v => object(v).marketplaceId === marketplaceId);
  }
  if (!Array.isArray(scoped.summaries) || scoped.summaries.length !== 1) return invalid("详情响应缺少唯一匹配站点摘要；保留旧版本。");
  const projected = object(project(scoped, model.definitions.Item, model));
  return { root, projected };
}
export function parseProductDetail(raw: string, policy: ListingDetailPolicy | CatalogDetailPolicy, index: number, marketplaceId: string): SafeFact {
  const listing = policy.resource === "listing_details", model = (listing ? listingModel : catalogModel) as Model;
  const { root, projected } = scopedRoot(raw, marketplaceId, model);
  if (listing ? root.sku !== policy.sellerSkus[index] : root.asin !== policy.asins[index]) return invalid("详情响应标识与审批集合不一致。");
  const summary = object((projected.summaries as unknown[])[0]);
  const asin = listing ? summary.asin : root.asin;
  if (asin !== undefined && (typeof asin !== "string" || !/^[A-Z0-9]{10}$/.test(asin))) return invalid();
  const fields = root.attributes === undefined ? { attributes: null, excludedAttributeCount: 0 } : attributes(root.attributes, marketplaceId);
  const facts = { ...projected, ...fields, marketplaceId, attributeCoverage: "PRODUCT_FIELD_ALLOWLIST", attributesReturned: root.attributes !== undefined, relationshipsReturned: root.relationships !== undefined, scopeMeaning: "APPROVED_IDENTIFIERS_SINGLE_MARKETPLACE", productMasterWrite: false };
  return observationFact(listing ? "LISTING_DETAIL" : "CATALOG_DETAIL", listing ? root.sku : root.asin, facts, { asin: asin as string ?? null, sellerSku: listing ? root.sku as string : null });
}
