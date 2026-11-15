import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sellfoxDatasets, sellfoxTableAllowList, sellfoxMcpToolDefinitions } from "../src/lib/sellfox/mcp-tool-registry";

/**
 * MCP query_data 把 dataset.columns 直接拼进 SELECT，列名写错时整条工具调用
 * 会抛 PostgreSQL undefined_column，且错误被统一 catch 记成 EXECUTION_FAILED，
 * 从日志里看不出是列名漂移。这里做静态一致性校验，把漂移挡在 CI。
 */
const schema = readFileSync(fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url)), "utf8");
const mcpSource = readFileSync(fileURLToPath(new URL("../src/lib/sellfox/mcp.ts", import.meta.url)), "utf8");

function modelFields(model: string): Set<string> {
  const block = schema.match(new RegExp(`^model ${model}\\s*\\{([\\s\\S]*?)^\\}`, "m"));
  assert.ok(block, `prisma/schema.prisma 中不存在 model ${model}`);
  // 只取小写开头的标量字段名；大写开头的是 relation 字段，不是数据库列。
  return new Set([...block[1].matchAll(/^\s*([a-z][A-Za-z0-9_]*)\s+[A-Za-z@]/gm)].map(match => match[1]));
}

/** 把 registry 里的 SQL 标识符还原成裸列名，例如 "\"storeId\"" -> "storeId"。 */
function bare(column: string): string {
  return column.replace(/^"|"$/g, "");
}

test("赛狐 MCP 每个数据集都指向真实的 Sellfox 模型，且表前缀保持隔离", () => {
  assert.ok(Object.keys(sellfoxDatasets).length > 0);
  for (const dataset of Object.values(sellfoxDatasets)) {
    assert.ok(dataset.table.startsWith("Sellfox"), `${dataset.key} 的表名必须以 Sellfox 开头`);
    assert.ok(modelFields(dataset.table).size > 0, `${dataset.key} 指向的模型没有可读取字段`);
    assert.equal(dataset.key, bare(dataset.key));
  }
});

test("赛狐 MCP 的 columns / dateField / storeColumn 全部是 schema 里存在的列", () => {
  for (const dataset of Object.values(sellfoxDatasets)) {
    const fields = modelFields(dataset.table);
    for (const column of dataset.columns) {
      assert.ok(
        fields.has(bare(column)),
        `${dataset.key}.columns 中的 ${column} 不是 ${dataset.table} 的真实列（query_data 会报 undefined_column）`,
      );
    }
    assert.ok(fields.has(dataset.dateField), `${dataset.key}.dateField=${dataset.dateField} 不是 ${dataset.table} 的真实列`);
    if (dataset.storeColumn) {
      assert.ok(fields.has(dataset.storeColumn), `${dataset.key}.storeColumn=${dataset.storeColumn} 不是 ${dataset.table} 的真实列`);
    }
  }
});

test("MCP 目录只登记显式 Sellfox 模型且不含凭证模型", () => {
  const credentialModels = ["SellfoxIntegrationCredential", "SellfoxMcpCredential"];
  for (const table of credentialModels) assert.ok(!sellfoxTableAllowList.includes(table), `${table} 不应开放给 MCP`);
  for (const table of sellfoxTableAllowList) assert.ok(modelFields(table).size > 0, `${table} 缺少真实 Prisma 模型`);
});

test("dataset 店铺列均可用于凭证围栏，模型带租户范围字段", () => {
  for (const dataset of Object.values(sellfoxDatasets)) {
    const fields = modelFields(dataset.table);
    if (dataset.scopeMode === "tenant_store" || dataset.scopeMode === "tenant_only") {
      assert.ok(fields.has("organizationId"), `${dataset.key}: 缺少 organizationId`);
      assert.ok(fields.has("workspaceId"), `${dataset.key}: 缺少 workspaceId`);
    }
    if (dataset.storeColumn) assert.ok(fields.has(dataset.storeColumn), `${dataset.key}: storeColumn 不是真实列`);
    if (dataset.scopeMode === "store_join") assert.ok(fields.has("storeId"), `${dataset.key}: store_join 缺少 storeId`);
  }
});

test("query_data 仅接受注册的数据集和声明的列", () => {
  const queryData = sellfoxMcpToolDefinitions.find(tool => tool.name === "sellfox.query_data");
  assert.ok(queryData, "query_data 工具定义缺失");
  const properties = (queryData!.inputSchema.properties ?? {}) as Record<string, { enum?: readonly string[] }>;
  assert.deepEqual(properties.dataset?.enum, Object.keys(sellfoxDatasets));
  assert.ok(mcpSource.includes("dataset.columns"), "查询必须使用数据集列白名单");
});

test("MCP 分析工具仍读取完整销量与当前库存视图", () => {
  assert.match(mcpSource, /FROM "sellfox_sales_daily"/);
  assert.match(mcpSource, /FROM "sellfox_inventory_current"/);
  assert.doesNotMatch(mcpSource, /COALESCE\([^)]*on_hand,\s*0\)/i);
});

function modelFieldTypes(model: string): Map<string, string> {
  const block = schema.match(new RegExp(`^model ${model}\\s*\\{([\\s\\S]*?)^\\}`, "m"));
  assert.ok(block, `prisma/schema.prisma 中不存在 model ${model}`);
  return new Map([...block[1].matchAll(/^\s*([a-z][A-Za-z0-9_]*)\s+([A-Za-z][A-Za-z0-9_]*)/gm)].map(match => [match[1], match[2]]));
}

test("数据集日期字段类型存在且受 schema 支持", () => {
  for (const dataset of Object.values(sellfoxDatasets)) {
    const type = modelFieldTypes(dataset.table).get(dataset.dateField);
    assert.ok(type, `${dataset.key}.${dataset.dateField} 不是 ${dataset.table} 的真实字段`);
    assert.ok(["String", "DateTime"].includes(type), `${dataset.key}.${dataset.dateField} 类型未覆盖: ${type}`);
  }
});

test("dataset 字段通过 query_data 明确白名单约束", () => {
  for (const dataset of Object.values(sellfoxDatasets)) {
    assert.ok(dataset.columns.length > 0, `${dataset.key} 缺少查询列`);
    assert.ok(dataset.columns.every(column => modelFields(dataset.table).has(bare(column))), `${dataset.key} 有非 schema 字段`);
  }
  assert.ok(mcpSource.includes("dataset.columns"));
});

test("MCP 数据集仅暴露已登记的 Sellfox 数据模型", () => {
  assert.deepEqual(sellfoxTableAllowList, [...new Set(Object.values(sellfoxDatasets).map(dataset => dataset.table))]);
  assert.ok(sellfoxTableAllowList.every(table => table.startsWith("Sellfox")));
});

test("MCP 查询使用凭证店铺范围，不通过全局空值绕过", () => {
  assert.ok(mcpSource.includes("storeScope"));
  assert.doesNotMatch(mcpSource, /OR\s+[^\n]*storeId\s+IS\s+NULL/i);
});
