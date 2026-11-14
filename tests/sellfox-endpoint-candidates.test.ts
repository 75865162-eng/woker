import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sellfoxEndpointCandidates } from "../src/lib/sellfox/endpoint-candidates";
import { sellfoxPlanGroups } from "../src/lib/sellfox/data-plan";
import { sellfoxKnownEndpoints } from "../src/lib/sellfox/known-endpoints";

/**
 * 待接入数据集 → 泛化端点候选的真实性校验。
 * 候选必须只由「已核对的真实只读路径」构成，绝不能把文档缺失路径、
 * 写接口或猜测出来的参数模板塞进同步编排链路。
 */
const recordsApi = readFileSync(fileURLToPath(new URL("../src/app/api/sellfox/endpoint-records/route.ts", import.meta.url)), "utf8");
const consoleSource = readFileSync(fileURLToPath(new URL("../src/components/sellfox/host/sync-console.tsx", import.meta.url)), "utf8");
const pageSource = [
  readFileSync(fileURLToPath(new URL("../src/app/(erp)/sellfox/endpoint-data/page.tsx", import.meta.url)), "utf8"),
  readFileSync(fileURLToPath(new URL("../src/app/(erp)/sellfox/endpoint-data/_components/EndpointDataWorkbench.tsx", import.meta.url)), "utf8"),
].join("\n");

const CODE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const WRITE_PATH = /\/(create|insert|update|delete|remove|add|modify|save|submit|cancel|close|approve|reject|audit|enable|disable|batch)[A-Za-z0-9_]*\.json$/i;

test("候选只来自 planned 数据集，且 code 符合端点配置规则", () => {
  const candidates = sellfoxEndpointCandidates();
  assert.ok(candidates.length >= 8, "真实只读路径候选不应被意外清空");
  const byId = new Map(sellfoxPlanGroups.flatMap(group => group.items).map(item => [item.id, item]));
  for (const candidate of candidates) {
    assert.ok(CODE.test(candidate.code), `${candidate.code} 不能作为端点 code`);
    const item = byId.get(candidate.code);
    assert.ok(item, `${candidate.code} 不在 data-plan 清单里`);
    assert.equal(item.status, "planned", `${candidate.code} 是 live/blocked，不应重复注册`);
    assert.equal(candidate.paramsContract, "PENDING_API_CONTRACT", "候选不得声称参数契约已就绪");
  }
});

test("候选路径全部是已核对的真实 /api/ 只读接口，不含写接口与文档占位", () => {
  for (const candidate of sellfoxEndpointCandidates()) {
    assert.ok(candidate.paths.length > 0, `${candidate.code} 没有可用真实路径`);
    for (const path of candidate.paths) {
      assert.ok(/^\/api\/[A-Za-z0-9_./-]{2,180}\.json$/.test(path), `${path} 不是真实 /api/ 路径`);
      assert.ok(!WRITE_PATH.test(path), `${path} 是写接口，系统只读不可接`);
      assert.ok(!path.includes("文档"), `${path} 是文档占位，不能进执行链路`);
    }
  }
});

test("已核对的重点待接入数据集都在候选里", () => {
  const codes = new Set(sellfoxEndpointCandidates().map(candidate => candidate.code));
  for (const expected of ["profit-report", "ads-manage", "aba", "returns", "settlement", "fba-fee"]) {
    assert.ok(codes.has(expected), `${expected} 有真实只读路径却未成为候选`);
  }
});

test("端点原始行承接链路存在且带租户围栏与口径声明", () => {
  assert.ok(recordsApi.includes('requireApiPermission("sellfox", "view"'), "读取接口必须做权限校验");
  assert.ok(recordsApi.includes("organizationId: permission.user.organizationId"), "读取接口必须按租户围栏");
  assert.ok(recordsApi.includes("endpointCode: code"), "读取接口必须按端点围栏");
  assert.ok(recordsApi.includes("RAW_API_RESPONSE_ROWS"), "必须声明原始响应口径");
  assert.ok(recordsApi.includes("不猜字段、不补零"), "必须声明不造数据");
  assert.ok(consoleSource.includes("/sellfox/endpoint-data?code="), "同步控制台必须能进入承接页");
  assert.ok(pageSource.includes("endpoint-records"), "承接页必须读取端点原始行接口");
  assert.ok(pageSource.includes("不补造占位行"), "空态必须明确不补造占位行");
});

test("每条候选路径都标注了本地字段文档或已登记种子，杜绝悬空路径", () => {
  const seeded = new Set(sellfoxKnownEndpoints().map(seed => seed.path));
  let documented = 0, seededCount = 0;
  for (const candidate of sellfoxEndpointCandidates()) {
    assert.equal(candidate.pathDocs.length, candidate.paths.length, `${candidate.code} 的路径与文档标注数量不一致`);
    for (const entry of candidate.pathDocs) {
      assert.ok(candidate.paths.includes(entry.path), `${candidate.code} 出现未登记的路径标注`);
      if (entry.seeded) {
        seededCount += 1;
        assert.ok(seeded.has(entry.path), `${entry.path} 声称已有种子，但 known-endpoints 里没有`);
      }
      if (entry.doc) {
        documented += 1;
        assert.ok(entry.doc.endsWith(".md"), `${entry.path} 的文档名不是本地字段文档`);
      }
      assert.ok(entry.seeded || entry.doc, `${entry.path} 既无种子也无字段文档，不能作为候选`);
    }
  }
  assert.ok(documented >= 30, `已核对的本地字段文档不应被意外清空（当前 ${documented}）`);
  assert.ok(seededCount >= 10, `与已登记种子的重合路径应被显式标注（当前 ${seededCount}）`);
  assert.ok(consoleSource.includes("candidateDocSummary"), "同步控制台必须展示文档/种子落地状态");
});
