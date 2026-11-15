import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  amazonLocalRawTables, amazonLocalRawExcluded, amazonLocalRawUnscoped, amazonLocalRawDisclosure,
  amazonLocalSensitiveColumn, amazonLocalScopeMode, amazonLocalVisibleColumns, amazonLocalOrderColumn,
} from "../src/lib/amazon-sync/local-raw-catalog";
import { amazonMcpToolDefinitions } from "../src/lib/amazon-sync/mcp-tool-registry";
import { amazonAccountReadTools } from "../src/lib/lili/account-tool-access";

/**
 * Amazon MCP「本地原始落地行全量读取」的静态防漂移校验。
 * 表名/围栏模式写错不会在编译期报错，只会在生产查询时越权或报 undefined_column，
 * 因此把封闭清单与 prisma/schema.prisma 的一致性挡在 CI。
 */
const schema = readFileSync(fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url)), "utf8");
const readSource = readFileSync(fileURLToPath(new URL("../src/lib/amazon-sync/local-raw-read.ts", import.meta.url)), "utf8");
const mcpSource = readFileSync(fileURLToPath(new URL("../src/lib/amazon-sync/mcp.ts", import.meta.url)), "utf8");

function modelFields(model: string): Set<string> {
  const block = schema.match(new RegExp(`^model ${model}\\s*\\{([\\s\\S]*?)^\\}`, "m"));
  assert.ok(block, `prisma/schema.prisma 中不存在 model ${model}`);
  return new Set([...block[1].matchAll(/^\s*([a-z][A-Za-z0-9_]*)\s+[A-Za-z@]/gm)].map(match => match[1]));
}

const amazonModels = [...schema.matchAll(/^model (Amazon\w+)\s*\{/gm)].map(match => match[1]);

test("封闭清单里每张表都是真实 Amazon 模型，且带完整租户列", () => {
  assert.ok(amazonLocalRawTables.length >= 40, "本地承接池目录不应被意外清空");
  for (const table of amazonLocalRawTables) {
    assert.ok(table.startsWith("Amazon"), `${table} 必须以 Amazon 前缀隔离，不能跨provider`);
    const fields = modelFields(table);
    assert.ok(fields.has("organizationId") && fields.has("workspaceId"), `${table} 缺少租户列，不能做租户围栏`);
  }
});

test("每个 Amazon 模型都被显式归类：可读 / 安全排除 / 无租户列", () => {
  const classified = new Set<string>([
    ...amazonLocalRawTables,
    ...amazonLocalRawExcluded.map(item => item.table),
    ...amazonLocalRawUnscoped,
  ]);
  assert.equal(classified.size, amazonLocalRawTables.length + amazonLocalRawExcluded.length + amazonLocalRawUnscoped.length,
    "三张清单有重复表名");
  const missing = amazonModels.filter(model => !classified.has(model));
  assert.deepEqual(missing, [], `新增的 Amazon 表未归类（schema 漂移）：${missing.join(", ")}`);
  const unknown = [...classified].filter(table => !amazonModels.includes(table));
  assert.deepEqual(unknown, [], `清单里指向不存在的模型：${unknown.join(", ")}`);
  for (const table of amazonLocalRawUnscoped) {
    const fields = modelFields(table);
    assert.ok(!(fields.has("organizationId") && fields.has("workspaceId")), `${table} 已有租户列，不应归为无租户表`);
  }
});

test("围栏模式与真实列形状一致，保证不会出现越权或 undefined_column", () => {
  for (const table of amazonLocalRawTables) {
    const columns = [...modelFields(table)];
    const mode = amazonLocalScopeMode(columns);
    if (mode === "store") {
      assert.ok(columns.includes("sellerAccountId") && columns.includes("marketplaceId"), `${table}: store 围栏缺列`);
    } else if (mode === "profile") {
      assert.ok(columns.includes("profileId"), `${table}: profile 围栏缺 profileId`);
      assert.ok(modelFields("AmazonAdsProfile").has("sellerAccountId"), "AmazonAdsProfile 必须有店铺列供反查");
    } else if (mode === "source") {
      assert.ok(columns.includes("sourceId"), `${table}: source 围栏缺 sourceId`);
      assert.ok(modelFields("AmazonSyncDataSource").has("marketplaceId"), "AmazonSyncDataSource 必须有站点列供反查");
    }
    const order = amazonLocalOrderColumn(columns);
    assert.ok(columns.includes(order), `${table}: 排序列 ${order} 不是真实列`);
    assert.ok(amazonLocalVisibleColumns(columns).length > 0, `${table}: 剔除敏感列后不能没有任何可返回字段`);
  }
});

test("敏感列在 SQL 投影层剔除，业务内容哈希保留以便追溯", () => {
  for (const name of ["credentialsCiphertext", "checkpointCiphertext", "tokenHash", "nextTokenCiphertext", "rawCiphertext", "refreshTokenExpiresAt", "secretCiphertext"]) {
    assert.ok(amazonLocalSensitiveColumn.test(name), `${name} 必须被判为敏感列`);
  }
  for (const name of ["rowHash", "detailHash", "contentHash", "snapshotHash", "observationHash"]) {
    assert.ok(!amazonLocalSensitiveColumn.test(name), `${name} 是业务内容哈希，应保留用于可追溯性`);
  }
  assert.ok(readSource.includes("amazonLocalVisibleColumns(columns)"), "必须在构造投影时剔除敏感列");
  assert.ok(readSource.includes("SET TRANSACTION READ ONLY"), "必须沿用仓库既有的只读事务边界");
  assert.ok(readSource.includes("assertAmazonLocalTable(input.table)"), "读取前必须做封闭表名校验");
});

test("两个新工具已注册为只读，且有显式 handler 与账号继承", () => {
  for (const name of ["amazon.data.local.tables", "amazon.data.local.read"]) {
    const definition = amazonMcpToolDefinitions.find(tool => tool.name === name);
    assert.ok(definition, `${name} 未注册到 Amazon MCP 工具目录`);
    assert.equal(definition!.operationMode, "READ_ONLY", `${name} 必须是只读`);
    assert.equal(definition!.canonicalName, name, `${name} 不应是别名`);
    assert.ok(amazonAccountReadTools.includes(name as never), `${name} 必须继承账号读取授权`);
    assert.ok(mcpSource.includes(`"${name}": invokeNamedTool("${name}")`), `${name} 缺少显式 handler 绑定`);
  }
  assert.ok(mcpSource.includes("amazon.data.local.tables\" || tool === \"amazon.data.local.read"), "MCP 执行链缺少新工具分支");
});

test("输出必须明确区分「原始落地行」与「已发布业务事实」", () => {
  assert.equal(amazonLocalRawDisclosure.dataClass, "RAW_LOCAL_ROWS");
  assert.equal(amazonLocalRawDisclosure.publicationStatus, "NOT_PUBLISHED_FACTS");
  assert.equal(amazonLocalRawDisclosure.provider, "amazon");
  assert.ok(amazonLocalRawDisclosure.warnings.some(warning => warning.includes("不得与")), "必须声明口径不可混算");
  assert.ok(readSource.includes("...amazonLocalRawDisclosure"), "两个读取入口都必须带上口径声明");
});

test("local.read 暴露时间范围、排序方向与封闭列过滤，且返回结构有契约", () => {
  const definition = amazonMcpToolDefinitions.find(tool => tool.name === "amazon.data.local.read");
  assert.ok(definition, "amazon.data.local.read 未注册");
  const properties = (definition!.inputSchema.properties ?? {}) as Record<string, { enum?: readonly string[] }>;
  for (const key of ["fromDate", "toDate", "sortDirection", "filterColumn", "filterValue"]) {
    assert.ok(properties[key], `local.read 缺少 ${key} 参数`);
  }
  assert.deepEqual(properties.sortDirection?.enum, ["asc", "desc"]);
  const output = definition!.outputSchema as { type?: string; properties?: Record<string, unknown> };
  assert.equal(output.type, "object");
  assert.ok(Object.keys(output.properties ?? {}).length >= 5, "outputSchema 不能退化成空 object");
  const tables = amazonMcpToolDefinitions.find(tool => tool.name === "amazon.data.local.tables");
  assert.ok(Object.keys((tables!.outputSchema as { properties?: Record<string, unknown> }).properties ?? {}).length >= 5,
    "local.tables 也需要返回结构契约");
});

test("local.read 按真实列类型做时间比较，过滤/排序都不接受客户端拼 SQL", () => {
  assert.ok(readSource.includes("dataTypes"), "必须从 information_schema 读取真实列类型，不猜类型");
  assert.ok(readSource.includes("dateClauses"), "时间范围必须按真实列类型分支");
  assert.ok(readSource.includes("::date + 1"), "timestamp 列的 toDate 必须含当天");
  assert.ok(readSource.includes("visible.includes(filterColumn)"), "过滤列必须落在该表真实可见物理列内");
  assert.ok(readSource.includes("Prisma.raw(direction)"), "排序方向只能是固定枚举，不能拼客户端字符串");
  assert.ok(readSource.includes("latestDateBasis") && readSource.includes("observedAt"), "必须返回数据更新时间与观测时间");
  assert.ok(readSource.includes("SET TRANSACTION READ ONLY"), "只读事务边界不能被移除");
  assert.ok(mcpSource.includes("fromDate: args.fromDate"), "handler 必须把新参数传入读取服务");
});
