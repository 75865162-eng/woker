import rawLiliSkills from "@/data/lili/skills.json";
import { skillDataTables } from "./mcp-datasets";
import { createHash } from "node:crypto";

export const skillFieldLevels = ["REQUIRED", "IMPORTANT", "OPTIONAL", "DERIVED", "EXTERNAL"] as const;
export const skillQualityStatuses = ["NOT_CONNECTED", "NOT_AUTHORIZED", "NOT_ELIGIBLE", "NOT_SUPPORTED", "NOT_REQUESTED", "NOT_RETURNED", "PARSE_FAILED", "PERSISTENCE_FAILED", "QUERY_FAILED", "ATTRIBUTION_PENDING", "HISTORY_INCOMPLETE", "CURRENCY_MISSING", "COMPLETE"] as const;
const reviewedSkillDataContracts = [
  {
    skill: "reimbursement-recovery",
    tools: ["data_list_tables", "data_describe_table", "data_sync_status", "data_sync_start"],
    executionPaths: [
      ["reimbursement_analyze", "data_query"],
      ["reimbursement_analyze", "reimbursement_get_events", "reimbursement_get_payments", "finance_get_transactions"],
      ["data_query"],
      ["reimbursement_get_events", "reimbursement_get_payments", "finance_get_transactions"],
    ],
    requirements: [
      { table: "inventory_events", fields: ["sellerSku", "businessDate", "eventType", "eventReferenceId", "eventQuantityOriginal", "unreconciledQuantityOriginal", "reconciliationStatus"], level: "REQUIRED" },
      { table: "inventory_events", fields: ["claimEligibility"], level: "IMPORTANT" },
      { table: "reimbursements", fields: ["sellerSku", "businessDate", "reimbursementId", "reimbursementQuantityOriginal", "amountTotalOriginal", "cashQuantityOriginal", "inventoryQuantityOriginal", "originalReimbursementId"], level: "REQUIRED" },
      { table: "reimbursements", fields: ["currencyCode"], level: "IMPORTANT" },
      { table: "finance_transactions", fields: ["originalAmount", "currency", "transactionType", "orderId"], level: "IMPORTANT" },
      { table: "ads_report_daily", fields: ["advertisedAsin", "reportDate", "spend"], level: "IMPORTANT" },
    ],
  },
  {
    skill: "clearance-aging-decision",
    tools: ["restock_get_clearance", "restock_get_forecast", "finance_get_fee_estimate"],
    requirements: [
      { table: "inventory", fields: ["sellerSku", "fulfillableQuantity", "reservedQuantity", "inboundShippedQuantity", "unfulfillableQuantity", "capturedAt"], level: "REQUIRED" },
      { table: "inventory_age", fields: ["sellerSku", "businessDate", "ageBuckets"], level: "REQUIRED" },
      { table: "sales_traffic_asin", fields: ["sellerSku", "businessDate", "unitsOrdered"], level: "REQUIRED" },
      { table: "economics_daily", fields: ["sellerSku", "purchaseCost", "freight", "effectiveDate"], level: "REQUIRED" },
      { table: "fee_preview", fields: ["sellerSku", "storageFee", "removalFee"], level: "IMPORTANT" },
    ],
  },
  {
    skill: "amazon-return-weekly-analysis",
    tools: ["data_query", "orders_get_recent", "market_get_reviews"],
    requirements: [
      { table: "returns", fields: ["returnAt", "sellerSku", "quantity", "reason", "disposition", "refundAmount"], level: "REQUIRED" },
      { table: "order_items", fields: ["createdTime", "sellerSku", "quantityOrdered"], level: "REQUIRED" },
      { table: "finance_transactions", fields: ["transactionType", "originalAmount", "currency"], level: "IMPORTANT" },
      { table: "reviews", fields: ["asin", "reviewDate", "rating", "reviewBody"], level: "IMPORTANT" },
    ],
  },
] as const;

/** Reviewed data dependencies can differ from stale tool names in the shipped
 * Skill; preserve both so readiness reflects callable services and drift. */
export const skillDataContracts = rawLiliSkills.map(skill => {
  const reviewed = reviewedSkillDataContracts.find(contract => contract.skill === skill.slug);
  const executionPaths = reviewed && "executionPaths" in reviewed ? reviewed.executionPaths : [];
  return { skill: skill.slug, tools: reviewed?.tools ?? skill.tools, executionPaths, sourceTools: skill.tools, requirements: reviewed?.requirements ?? [], sourceSteps: skill.stepsZh,
    source: "src/data/lili/skills.json", sourceSha256: createHash("sha256").update(JSON.stringify(skill)).digest("hex"),
    contractStatus: reviewed ? "FIELD_CONTRACT_DRAFT" : "TOOL_DEPENDENCIES_ONLY" };
});

export function skillReadiness(availability: Array<{ name: string; available: boolean; schemaStatus: string; freshness?: string; rowCount?: number | null; accessStatus?: string }>, executableTools: readonly string[]) {
  const byName = new Map(availability.map(table => [table.name, table]));
  return skillDataContracts.map(contract => {
    const missingTools = [
      ...contract.tools.filter(tool => !executableTools.includes(tool)),
      ...(contract.executionPaths.length && !contract.executionPaths.some(path => path.every(tool => executableTools.includes(tool)))
        ? [`one_of:${contract.executionPaths.map(path => path.join("+")).join("|")}`] : []),
    ];
    const requirements = contract.requirements.map(requirement => {
      const table = byName.get(requirement.table);
      const schema = skillDataTables.find(item => item.name === requirement.table);
      const knownFields = new Set(schema?.fields.map(field => field.name) ?? []);
      const unsupportedFields = requirement.fields.filter(field => !knownFields.has(field));
      const missingReason = table?.accessStatus ?? (!table?.available ? "DATASET_UNAVAILABLE" : unsupportedFields.length ? "FIELD_NOT_MAPPED"
        : table.schemaStatus !== "SCHEMA_VERIFIED" ? "SCHEMA_UNVERIFIED" : table.freshness === "stale" ? "HISTORY_INCOMPLETE" : null);
      return { ...requirement, available: !missingReason, missingReason, unsupportedFields };
    });
    const requiredBlocked = requirements.some(requirement => requirement.level === "REQUIRED" && !requirement.available);
    const status = contract.contractStatus !== "FIELD_CONTRACT_VERIFIED" || missingTools.length || requiredBlocked
      ? "NOT_READY" : "DATA_READY_UNVERIFIED";
    return { skill: contract.skill, status, contractStatus: contract.contractStatus,
      fieldReviewRequired: true, missingTools, requirements,
      endToEndStatus: "NOT_VERIFIED", evidence: "Field values, requested date range and live Skill execution are not verified by this source-availability check." };
  });
}
