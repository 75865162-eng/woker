import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSellfoxFullSyncPlan, validateSellfoxEndpointInput, sellfoxWindowsCover,
} from "../src/lib/sellfox/sync-orchestrator";
import {
  renderSellfoxEndpointParams, sellfoxEndpointRows, sellfoxEndpointRecordId, sellfoxEndpointPageCount,
} from "../src/lib/sellfox/generic-endpoint-sync";
import { sellfoxSyncResources } from "../src/lib/sellfox/sync-contract";
import { sellfoxDateChunks } from "../src/lib/sellfox/sync-rules";

test("全量计划由规则表展开：内置域按依赖顺序，分块上限生效", () => {
  const plan = buildSellfoxFullSyncPlan({ from: "2026-08-17", to: "2026-11-14", today: "2026-11-15" });
  assert.equal(plan[0].resource, "stores");
  assert.ok(!plan[0].startDate, "无日期资源不带窗口");
  const listings = plan.find((item) => item.resource === "listings");
  assert.equal(listings?.reportDate, "2026-11-15", "当前状态类用今天，不是 T-1");
  const report = plan.filter((item) => item.resource === "ads_report");
  const targeting = plan.filter((item) => item.resource === "ads_targeting");
  assert.deepEqual(report, sellfoxDateChunks("2026-08-17", "2026-11-14", 14).map((chunk) => ({ ...chunk, resource: "ads_report", label: "广告商品报表", trigger: "auto_full" })));
  assert.ok(targeting.length > report.length, "高量报表分块更细");
  for (const item of report) assert.ok(item.startDate && item.endDate && item.startDate <= item.endDate);
  for (const resource of new Set(plan.map((item) => item.resource))) assert.ok(sellfoxSyncResources.includes(resource as (typeof sellfoxSyncResources)[number]));
});

test("全量计划把后台配置的端点纳入，且可只跑端点", () => {
  const plan = buildSellfoxFullSyncPlan({
    from: "2026-11-01", to: "2026-11-14", today: "2026-11-15", builtinResources: [],
    endpoints: [{ code: "fx_rate", label: "汇率", dateMode: "range", chunkDays: 7 }],
  });
  assert.equal(plan.length, 2);
  assert.ok(plan.every((item) => item.resource === "endpoint:fx_rate" && item.endpointCode === "fx_rate"));
  assert.equal(plan[0].startDate, "2026-11-01");
  assert.equal(plan[1].endDate, "2026-11-14");
  const current = buildSellfoxFullSyncPlan({ from: "2026-11-14", to: "2026-11-14", today: "2026-11-15", builtinResources: [], endpoints: [{ code: "shop_cfg", label: "店铺配置", dateMode: "none", chunkDays: 7 }] });
  assert.equal(current.length, 1);
  assert.ok(!current[0].startDate && !current[0].reportDate);
  assert.throws(() => buildSellfoxFullSyncPlan({ from: "2026-01-01", to: "2026-11-14", limit: 5 }), /超过单次上限/);
});

test("后台配置经过白名单校验，非法接口/参数不进执行链路", () => {
  const valid = validateSellfoxEndpointInput({
    code: "fx_rate", label: "汇率", path: "/api/base/exchangeRate.json", dateMode: "range",
    scopeMode: "store", chunkDays: 7, pageSize: 100, params: '{"pageNo":"${pageNo}"}',
    rowsPath: "data.rows", idFields: "id,date", historyFrom: "2026-08-17", enabled: false,
  });
  assert.equal(valid.code, "fx_rate");
  assert.equal(valid.historyFrom, "2026-08-17");
  assert.equal(valid.maxRows, 50000);
  assert.throws(() => validateSellfoxEndpointInput({ code: "BAD!", path: "/api/x.json" }), /端点 code/);
  assert.throws(() => validateSellfoxEndpointInput({ code: "ok_code", path: "https://evil.example/x" }), /接口路径/);
  assert.throws(() => validateSellfoxEndpointInput({ code: "ok_code", path: "/api/x.json", chunkDays: 999 }), /分块天数/);
  assert.throws(() => validateSellfoxEndpointInput({ code: "ok_code", path: "/api/x.json", params: "[1,2]" }), /JSON 对象/);
  assert.throws(() => validateSellfoxEndpointInput({ code: "ok_code", path: "/api/x.json", historyFrom: "yesterday" }), /历史起点/);
});

test("参数模板按店铺/日期/分页替换，未知变量原样保留不猜值", () => {
  const template = '{"shopIds":["${shopId}"],"pageNo":"${pageNo}","pageSize":"${pageSize}","start":"${startDate}","end":"${endDate}","nested":{"d":"${today}"},"unknown":"${mystery}"}';
  const rendered = renderSellfoxEndpointParams(template, {
    shopId: "S1", startDate: "2026-11-01", endDate: "2026-11-07", pageNo: "2", pageSize: "100", today: "2026-11-15",
  });
  assert.deepEqual(rendered.shopIds, ["S1"]);
  assert.equal(rendered.pageNo, "2");
  assert.equal(rendered.start, "2026-11-01");
  assert.deepEqual(rendered.nested, { d: "2026-11-15" });
  assert.equal(rendered.unknown, "${mystery}");
  assert.deepEqual(renderSellfoxEndpointParams("", {}), {});
  assert.throws(() => renderSellfoxEndpointParams("not json", {}), /合法 JSON/);
  assert.throws(() => renderSellfoxEndpointParams("[1]", {}), /JSON 对象/);
});

test("响应行解析、行身份与分页页数", () => {
  const rows = [{ id: "1", amount: "12.30", currency: "USD" }];
  assert.deepEqual(sellfoxEndpointRows({ data: { rows } }, "data.rows"), rows);
  // sellfoxPost 已解包 payload.data；结算 V2 的种子 rowsPath 指向顶层行键，不再带 data. 前缀。
  assert.deepEqual(sellfoxEndpointRows({ detailPageVoList: rows, totalSize: 1 }, "detailPageVoList"), rows);
  assert.deepEqual(sellfoxEndpointRows({ groupVoList: rows, totalSize: 1 }, "groupVoList"), rows);
  assert.deepEqual(sellfoxEndpointRows({ rows }, ""), rows);
  assert.deepEqual(sellfoxEndpointRows({ list: rows }, ""), rows);
  assert.throws(() => sellfoxEndpointRows({ data: {} }, "missing.path"), /rowsPath/);
  assert.throws(() => sellfoxEndpointRows({ data: "oops" }, ""), /赛狐端点响应/);
  assert.equal(sellfoxEndpointRecordId(rows[0], "id,currency"), "1|USD");
  assert.equal(sellfoxEndpointRecordId(rows[0], "id"), "1");
  const hash = sellfoxEndpointRecordId(rows[0], "missingField");
  assert.match(hash, /^[a-f0-9]{40}$/);
  assert.equal(hash, sellfoxEndpointRecordId({ currency: "USD", amount: "12.30", id: "1" }, ""), "键顺序不同内容相同仍幂等");
  assert.equal(sellfoxEndpointPageCount({ totalPage: 3 }), 3);
  assert.equal(sellfoxEndpointPageCount({ data: { totalSize: 250 } }), 3);
  assert.equal(sellfoxEndpointPageCount({ data: { totalSize: 250 } }, 50), 5, "分页页数按配置 pageSize 计算");
  assert.equal(sellfoxEndpointPageCount({ rows: [] }), null);
});

test("连续覆盖游标在乱序、嵌套、相邻窗口及失败洞下不跳步", async () => {
  const { sellfoxNextUncoveredDate } = await import("@/lib/sellfox/sync-orchestrator");
  const windows = [
    { startDate: "2026-11-07", endDate: "2026-11-09" },
    { startDate: "2026-11-03", endDate: "2026-11-04" },
    { startDate: "2026-10-30", endDate: "2026-11-02" },
    { startDate: "2026-11-01", endDate: "2026-11-01" },
  ];
  assert.equal(sellfoxNextUncoveredDate("2026-11-01", windows), "2026-11-05");
  assert.equal(sellfoxNextUncoveredDate("2026-11-01", [...windows, { startDate: "2026-11-05", endDate: "2026-11-06" }]), "2026-11-10");
  assert.equal(sellfoxNextUncoveredDate("2026-11-01", []), "2026-11-01");
  assert.equal(sellfoxNextUncoveredDate("2026-11-01", [{ startDate: "2026-11-02", endDate: "2026-11-03" }]), "2026-11-01");
  assert.equal(sellfoxNextUncoveredDate("2026-11-01", [{ startDate: "bad", endDate: null }, { startDate: "2026-11-03", endDate: "2026-11-01" }]), "2026-11-01");
});

test("配置即全量：默认计划覆盖全部内置域并透传配置触发器", () => {
  const trigger = "credential_bootstrap_full";
  const plan = buildSellfoxFullSyncPlan({ from: "2026-10-17", to: "2026-11-14", today: "2026-11-15", trigger });
  const resources = new Set(plan.map((item) => item.resource));
  // 所有内置资源（含 stores 与订单详情）都必须进入配置后的全量计划，
  // 才有「一配置好 API 就全量拉取并永久落库」的完整数据域覆盖。
  for (const resource of sellfoxSyncResources) assert.ok(resources.has(resource), `全量计划缺少内置域 ${resource}`);
  assert.ok(plan.every((item) => item.trigger === trigger), "配置触发器必须透传到每个任务，供审计区分来源");
  assert.equal(plan[0].resource, "stores", "店铺主数据仍排在全量计划最前，保证依赖顺序");
});

test("已完成分块窗口覆盖失败的大窗口时不重复拆分", () => {
  const chunks = sellfoxDateChunks("2026-08-17", "2026-11-14", 14);
  assert.equal(sellfoxWindowsCover("2026-08-17", "2026-11-14", chunks), true);
  assert.equal(sellfoxWindowsCover("2026-08-17", "2026-11-14", chunks.slice(0, 3)), false);
  assert.equal(sellfoxWindowsCover("2026-08-17", "2026-11-14", []), false);
  assert.equal(sellfoxWindowsCover("2026-09-01", "2026-09-10", [{ startDate: "2026-08-17", endDate: "2026-11-14" }]), true);
  assert.equal(sellfoxWindowsCover("2026-09-01", "2026-09-10", [{ startDate: "2026-09-01", endDate: "2026-09-04" }, { startDate: "2026-09-06", endDate: "2026-09-10" }]), false, "中间缺口必须被发现");
  assert.equal(sellfoxWindowsCover("2026-09-01", "2026-09-10", [{ startDate: "bad", endDate: null }]), false);
});
