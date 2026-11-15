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

test("除凭证表外，schema 里每个 Sellfox 模型都必须登记为 MCP 数据集", () => {
  // 承接池里已落地的表如果没登记，MCP 就「读不到全部数据」。
  const credentialModels = new Set(["SellfoxIntegrationCredential", "SellfoxMcpCredential"]);
  const models = [...schema.matchAll(/^model (Sellfox\w+)\s*\{/gm)].map(match => match[1]);
  const registered = new Set(sellfoxTableAllowList);
  const missing = models.filter(model => !credentialModels.has(model) && !registered.has(model));
  assert.deepEqual(missing, [], `这些 Sellfox 表已落地但 MCP 读不到：${missing.join(", ")}`);
  for (const table of registered) {
    assert.ok(!credentialModels.has(table), `${table} 是凭证表，禁止登记进 MCP 目录`);
  }
});

test("scopeMode 与模型的租户/店铺列形状一致，围栏不会指向不存在的列", () => {
  for (const dataset of Object.values(sellfoxDatasets)) {
    const fields = modelFields(dataset.table);
    const hasTenant = fields.has("organizationId") && fields.has("workspaceId");
    if (dataset.scopeMode === "tenant_store") {
      assert.ok(hasTenant, `${dataset.key}: tenant_store 要求表带 organizationId/workspaceId`);
      assert.ok(dataset.storeColumn, `${dataset.key}: tenant_store 要求 storeColumn`);
      assert.ok(fields.has(dataset.storeColumn!), `${dataset.key}: storeColumn 不是真实列`);
    } else if (dataset.scopeMode === "tenant_only") {
      assert.ok(hasTenant, `${dataset.key}: tenant_only 要求表带 organizationId/workspaceId`);
      assert.equal(dataset.storeColumn, null, `${dataset.key}: tenant_only 不应声明 storeColumn`);
    } else {
      assert.equal(dataset.scopeMode, "store_join");
      assert.equal(dataset.storeColumn, "storeId", `${dataset.key}: store_join 需要 storeId`);
      assert.ok(fields.has("storeId"), `${dataset.key}: store_join 的表缺少 storeId`);
      assert.ok(!hasTenant, `${dataset.key}: 无租户列才需要 store_join`);
    }
    for (const column of dataset.excludedColumns ?? []) {
      assert.ok(fields.has(column), `${dataset.key}.excludedColumns 中的 ${column} 不是真实列，排除会失效`);
    }
  }
});

test("query_data 默认返回整行全字段，并保留 summary 兼容投影", () => {
  assert.ok(mcpSource.includes('fields === "summary"'), "query_data 必须支持 fields=summary 兼容投影");
  assert.ok(mcpSource.includes('"t.*"'), "query_data 默认必须使用 SELECT t.* 返回全部物理字段");
  const queryData = sellfoxMcpToolDefinitions.find(tool => tool.name === "sellfox.query_data");
  assert.ok(queryData, "query_data 工具定义缺失");
  const properties = (queryData!.inputSchema.properties ?? {}) as Record<string, { enum?: readonly string[] }>;
  assert.deepEqual(properties.fields?.enum, ["all", "summary"]);
  assert.deepEqual(properties.dataset?.enum, Object.keys(sellfoxDatasets));
});

test("MCP 分析工具里硬编码的物理表列引用也必须存在", () => {
  // 这几个别名在 mcp.ts 的 SQL 中固定指向物理表；CTE 别名不在此表内，自动跳过。
  const aliasTables: Record<string, string> = {
    s: "SellfoxSalesDailySnapshot",
    i: "SellfoxFbaInventorySnapshot",
    i2: "SellfoxFbaInventorySnapshot",
    a: "SellfoxAdsProductDaily",
  };
  const referenced = new Set<string>();
  const pattern = /(?<![\w.])(i2|i|s|a)\.(?:"([A-Za-z_][A-Za-z0-9_]*)"|([a-z][A-Za-z0-9_]*)(?![\w]))/g;
  for (const match of mcpSource.matchAll(pattern)) {
    const alias = match[1];
    const column = match[2] ?? match[3];
    referenced.add(`${alias}.${column}`);
    const table = aliasTables[alias];
    assert.ok(
      modelFields(table).has(column),
      `mcp.ts 中 ${alias}."${column}" 不是 ${table} 的真实列（分析工具 SQL 会失败）`,
    );
  }
  assert.ok(referenced.size >= 10, "没有解析到足够的物理表列引用，检查正则是否失效");
});

function modelFieldTypes(model: string): Map<string, string> {
  const block = schema.match(new RegExp(`^model ${model}\\s*\\{([\\s\\S]*?)^\\}`, "m"));
  assert.ok(block, `prisma/schema.prisma 中不存在 model ${model}`);
  return new Map([...block[1].matchAll(/^\s*([a-z][A-Za-z0-9_]*)\s+([A-Za-z][A-Za-z0-9_]*)/gm)].map(match => [match[1], match[2]]));
}

test("dateIsText 标注必须与 schema 真实类型一致，否则时间范围查询报 42883", () => {
  // 实库核对：10 个业务日期列是 TEXT，15 个是 timestamp；写成 text >= date 会直接失败。
  let textCount = 0;
  for (const dataset of Object.values(sellfoxDatasets)) {
    const type = modelFieldTypes(dataset.table).get(dataset.dateField);
    assert.ok(type, `${dataset.key}.dateField=${dataset.dateField} 不是 ${dataset.table} 的真实列`);
    const isText = type === "String";
    assert.ok(isText || type === "DateTime", `${dataset.key}.${dataset.dateField} 类型是 ${type}，需要人工确认时间比较写法`);
    assert.equal(Boolean(dataset.dateIsText), isText,
      `${dataset.key}.${dataset.dateField} 在 schema 里是 ${type}，dateIsText 标注与真实类型不符`);
    if (isText) textCount += 1;
  }
  assert.equal(textCount, 10, "TEXT 日期列数量变化时必须同步复核时间比较实现");
});

test("query_data 按列类型生成时间范围，返回总量、排序与当前态/历史版本口径", () => {
  assert.ok(mcpSource.includes("dateRangeClauses"), "时间范围必须按真实列类型分支生成");
  assert.ok(mcpSource.includes("::text"), "TEXT 日期列必须用文本比较");
  assert.ok(mcpSource.includes("::date + 1"), "timestamp 列的 toDate 必须含当天");
  assert.ok(mcpSource.includes("versionClause") && mcpSource.includes("SellfoxSnapshotHead"), "必须提供 Head 当前态过滤");
  assert.ok(mcpSource.includes("count(*)::int AS n"), "必须返回围栏内精确总行数");
  assert.ok(mcpSource.includes("rowCountBasis") && mcpSource.includes("latestDate"), "必须返回来源、更新时间与计数口径");
  const queryData = sellfoxMcpToolDefinitions.find(tool => tool.name === "sellfox.query_data");
  assert.equal(queryData?.version, "2.2.0");
  const properties = (queryData!.inputSchema.properties ?? {}) as Record<string, { enum?: readonly string[] }>;
  assert.deepEqual(properties.sortDirection?.enum, ["asc", "desc"]);
  assert.deepEqual(properties.versionScope?.enum, ["current", "history", "all"]);
});

test("Head 版本配置指向真实列，且 resource 名与同步侧写入一致", () => {
  const syncSources = ["snapshot-sync.ts", "listing-sync.ts", "fba-shipment-sync.ts"]
    .map(file => readFileSync(fileURLToPath(new URL(`../src/lib/sellfox/${file}`, import.meta.url)), "utf8")).join("\n");
  const configured = Object.values(sellfoxDatasets).filter(dataset => dataset.headResource);
  for (const dataset of configured) {
    assert.ok(dataset.versionColumn, `${dataset.key} 有 headResource 就必须有 versionColumn`);
    assert.ok(modelFields(dataset.table).has(dataset.versionColumn!), `${dataset.key}.versionColumn 不是真实列`);
    assert.ok(modelFields("SellfoxSnapshotHead").has("capturedAt"), "Head 表必须有 capturedAt");
    assert.ok(syncSources.includes(`resource: \"${dataset.headResource}\"`),
      `${dataset.key}.headResource=${dataset.headResource} 在同步侧没有对应的 Head 写入`);
  }
  assert.deepEqual(configured.map(dataset => dataset.headResource).sort(), ["fba_shipments", "inventory", "listings"]);
});

test("无店铺归属的全局行不得对单店凭证放行（实库验收发现的越权）", () => {
  // api_records 有 storeId IS NULL 的全局采集行；旧实现用 (match OR IS NULL) 让任意凭证都能读到。
  assert.ok(!/this\.fence\([^)]*nullableStore/.test(mcpSource), "whereDataset 不得再用 nullableStore 放宽店铺围栏");
  assert.ok(!/fence\(alias: string, column: string, nullable/.test(mcpSource), "fence 不得保留 nullable 放行参数");
  assert.ok(mcpSource.includes('storeScope.includes("*")'), "全店铺凭证仍需能读到全局行");
  assert.equal(sellfoxDatasets.api_records.nullableStore, true, "api_records 的全局行形状必须保留标注");
});
