import assert from "node:assert/strict";
import test from "node:test";
import { skillDataContracts, skillReadiness } from "../src/lib/amazon-sync/skill-contracts";
import { skillDataTables } from "../src/lib/amazon-sync/mcp-datasets";
import { amazonMcpToolDefinitions } from "../src/lib/amazon-sync/mcp-tool-registry";
import { availableSkillTables, skillTableAvailability } from "../src/lib/amazon-sync/skill-data";

test("readiness contracts expose missing datasets and tools without claiming unverified skills are ready", () => {
  const empty = skillReadiness([], ["data_query"]);
  assert.deepEqual(empty.map(item => item.skill), skillDataContracts.map(item => item.skill));
  for (const item of empty) {
    assert.equal(item.status, "NOT_READY");
    assert.equal(item.endToEndStatus, "NOT_VERIFIED");
  }
  assert.ok(empty.find(item => item.skill === "reimbursement-recovery")?.requirements.some(requirement => requirement.missingReason === "DATASET_UNAVAILABLE"));
  assert.ok(empty.filter(item => item.contractStatus === "TOOL_DEPENDENCIES_ONLY").every(item => item.fieldReviewRequired));
});

test("catalog availability never claims readiness when required fields are unmapped or schemas are unverified", () => {
  const availability = skillDataContracts.flatMap(contract => contract.requirements.map(requirement => ({
    name: requirement.table, available: true, schemaStatus: "confirmed",
  })));
  const tools = [...new Set(skillDataContracts.flatMap(contract => contract.tools))];
  const all = skillReadiness(availability, tools);
  assert.equal(all.length, 116);
  assert.ok(all.filter(item => item.contractStatus === "FIELD_CONTRACT_DRAFT").every(item => item.status === "NOT_READY"));
  assert.ok(all.filter(item => item.contractStatus === "TOOL_DEPENDENCIES_ONLY").every(item => item.status === "NOT_READY"));
  assert.ok(all.every(item => item.endToEndStatus === "NOT_VERIFIED"));
  assert.ok(all.some(item => item.requirements.some(requirement => requirement.missingReason === "FIELD_NOT_MAPPED" || requirement.missingReason === "SCHEMA_UNVERIFIED")));

  const withoutReturns = skillReadiness(availability.filter(table => table.name !== "returns"), tools);
  assert.equal(withoutReturns.find(item => item.skill === "amazon-return-weekly-analysis")?.requirements.find(requirement => requirement.table === "returns")?.missingReason, "DATASET_UNAVAILABLE");

  const withoutTool = skillReadiness(availability, tools.filter(tool => tool !== "orders_get_recent"));
  const returns = withoutTool.find(item => item.skill === "amazon-return-weekly-analysis");
  assert.equal(returns?.status, "NOT_READY");
  assert.deepEqual(returns?.missingTools, ["orders_get_recent"]);
});

test("reimbursement contract uses implemented tools and queryable report fields", () => {
  const contract = skillDataContracts.find(item => item.skill === "reimbursement-recovery")!;
  assert.deepEqual(contract.tools, ["data_list_tables", "data_describe_table", "data_sync_status", "data_sync_start"]);
  assert.deepEqual(contract.executionPaths, [
    ["reimbursement_analyze", "data_query"],
    ["reimbursement_analyze", "reimbursement_get_events", "reimbursement_get_payments", "finance_get_transactions"],
    ["data_query"],
    ["reimbursement_get_events", "reimbursement_get_payments", "finance_get_transactions"],
  ]);
  assert.deepEqual(contract.sourceTools, ["data_list_tables", "data_describe_table", "data_sync_status", "data_query", "reimbursement_get_events", "reimbursement_get_payments", "finance_get_transactions", "reimbursement_analyze", "data_sync_start"]);
  for (const name of [...contract.tools, ...contract.executionPaths.flat()]) assert.ok(amazonMcpToolDefinitions.some(tool => tool.name === name), `unregistered tool ${name}`);
  for (const requirement of contract.requirements) {
    const schema = skillDataTables.find(table => table.name === requirement.table)!;
    assert.deepEqual(requirement.fields.filter(name => !schema.fields.some(field => field.name === name)), []);
  }
  const availability = ["inventory_events", "reimbursements", "finance_transactions", "ads_report_daily"].map(name => ({ name, available: true, schemaStatus: "SCHEMA_VERIFIED" }));
  const ready = skillReadiness(availability, [...contract.tools, "data_query"]);
  const result = ready.find(item => item.skill === contract.skill)!;
  assert.deepEqual(result.missingTools, []);
  assert.equal(result.contractStatus, "FIELD_CONTRACT_DRAFT");
  assert.equal(result.status, "NOT_READY");
  assert.equal(result.endToEndStatus, "NOT_VERIFIED");

  const dedicatedOnly = skillReadiness(availability, [...contract.tools, "reimbursement_get_events", "reimbursement_get_payments", "finance_get_transactions"])
    .find(item => item.skill === contract.skill)!;
  assert.deepEqual(dedicatedOnly.missingTools, []);
  const missingReadPath = skillReadiness(availability, contract.tools)
    .find(item => item.skill === contract.skill)!;
  assert.ok(missingReadPath.missingTools.some(tool => tool.startsWith("one_of:")));
});

test("seller-scoped access marks finance as unauthorized even when the device credential includes its tool", () => {
  const availability = [
    ...["inventory_events", "reimbursements", "finance_transactions"].map(name => ({ name, available: true, schemaStatus: "SCHEMA_VERIFIED" })),
    { name: "ads_report_daily", available: true, schemaStatus: "SCHEMA_VERIFIED" },
  ].map(table => table.name === "finance_transactions" ? { ...table, accessStatus: "NOT_AUTHORIZED" } : table);
  const contract = skillDataContracts.find(item => item.skill === "reimbursement-recovery")!;
  const result = skillReadiness(availability, [...contract.tools, "data_query"])
    .find(item => item.skill === contract.skill)!;
  assert.deepEqual(result.missingTools, []);
  assert.equal(result.requirements.find(item => item.table === "finance_transactions")?.missingReason, "NOT_AUTHORIZED");
  assert.equal(result.status, "NOT_READY");
});

test("page-committed finance facts remain discoverable while the source window is still running", () => {
  const source = {
    id: "finance-source",
    resource: "finance",
    sellerAccountId: "seller-1",
    marketplaceId: "ATVPDKIKX0DER",
    activeRunId: "run-1",
    lastSuccessAt: new Date("2026-11-06T15:45:37.942Z"),
    freshnessMinutes: 2880,
    rowCount: 64829,
    publishedRun: { status: "RUNNING", executionVersion: 2, resource: "finance", sourceId: "finance-source", finishedAt: null, stage: "FETCHING" },
  };
  assert.ok(availableSkillTables([source]).some(table => table.name === "finance_transactions"));
  const availability = skillTableAvailability([source]).find(table => table.name === "finance_transactions");
  assert.equal(availability?.available, true);
  assert.equal(availability?.sourceCount, 1);
  assert.equal(availability?.rowCount, 64829);
});
