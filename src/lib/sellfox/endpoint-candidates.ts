import { sellfoxPlanGroups, type SellfoxPlanItem } from "./data-plan";
import { sellfoxKnownEndpoints } from "./known-endpoints";

/**
 * 待接入数据集 → 泛化端点候选。
 *
 * 背景：data-plan.ts 里 28+ 个 `planned` 数据集不需要各写一个同步器。
 * 通用采集器（generic-endpoint-sync.ts）已能按「店铺 × 日期块」拉取任意只读接口，
 * 并把原始响应整行落到 SellfoxApiRecord，再由 /sellfox/endpoint-data 承接验收。
 *
 * 真实性边界（必须保持）：
 * - 只收录 data-plan.ts 中已核对过的真实 /api/ 路径；标注「文档：…」的路径一律不收。
 * - 过滤写接口（create/update/delete/add 等），系统只做读，不接增删改。
 * - 参数模板（params）明确标记为「待联调」，不猜请求字段名，不自动生成可执行端点。
 * - 这里只产出候选清单，不写数据库、不自动启用；启用前必须由运维补齐参数契约。
 * - 本地字段文档位于工作区 sellfox-api-docs/，不在本仓库内，因此只把「路径 → 文档文件名」
 *   的核对结果固化为静态常量，运行时不读文件系统（部署后文档并不存在）。
 */
export type SellfoxEndpointCandidate = {
  code: string;
  label: string;
  priority: "P0" | "P1" | "P2";
  paths: string[];
  /** 每条路径的落地状态：seeded 表示已有可直接登记的真实种子，doc 为本地字段文档名。 */
  pathDocs: Array<{ path: string; doc: string | null; seeded: boolean }>;
  paramsContract: "PENDING_API_CONTRACT";
  note: string;
};

/** 2026-11-15 逐条核对 sellfox-api-docs/api 字段级文档的结果，未做任何参数猜测。 */
const PATH_DOCS: Record<string, string> = {
  "/api/cpc/searchTerms/pageList.json": "ABA搜索词__api-426587990.md",
  "/api/cpc/manageData/spCampaign.json": "SP广告活动__api-367482273.md",
  "/api/cpc/manageData/spGroup.json": "SP广告组__api-367482276.md",
  "/api/cpc/manageData/spAdProduct.json": "SP广告产品__api-367482277.md",
  "/api/cpc/manageData/spKeyword.json": "SP关键词投放__api-367482278.md",
  "/api/cpc/manageData/spTarget.json": "SP商品投放__api-367482279.md",
  "/api/cpc/manageData/spNeKeyword.json": "SP否定关键词__api-367482280.md",
  "/api/cpc/manageData/spNeTarget.json": "SP否定商品__api-367482281.md",
  "/api/cpc/manageData/sbCampaign.json": "SB广告活动__api-367482282.md",
  "/api/cpc/manageData/sbGroup.json": "SB广告组__api-367482263.md",
  "/api/cpc/manageData/sbAdProduct.json": "SB广告产品(创意)__api-367482264.md",
  "/api/cpc/manageData/sbTarget.json": "SB商品投放__api-367482266.md",
  "/api/cpc/manageData/sbKeyword.json": "SB关键词投放__api-367482265.md",
  "/api/cpc/manageData/sbNeKeyword.json": "SB否定关键词__api-367482267.md",
  "/api/cpc/manageData/sbNeTarget.json": "SB否定商品__api-367482268.md",
  "/api/cpc/manageData/sdCampaign.json": "SD广告活动__api-367482269.md",
  "/api/cpc/manageData/sdGroup.json": "SD广告组__api-367482270.md",
  "/api/cpc/manageData/sdAdProduct.json": "SD广告产品__api-367482271.md",
  "/api/cpc/manageData/sdCreative.json": "SD广告创意__api-367482272.md",
  "/api/cpc/manageData/sdTarget.json": "SD商品投放__api-367482274.md",
  "/api/cpc/manageData/sdNeTarget.json": "SD否定商品__api-367482275.md",
  "/api/fba/shippingOrder/items.json": "FBA发货单产品查询__api-51516613.md",
  "/api/fba/shippingOrder/detailByShipSn.json": "FBA发货单详情__api-188252058.md",
  "/api/finance/fbaStockDetail/pageList.json": "FBA仓库-明细__api-436026010.md",
  "/api/finance/fbaWarehouseSummary/pageList.json": "FBA仓库-汇总__api-436026011.md",
  "/api/fbaShipment/shipmentItemList.json": "FBA货件产品查询__api-382285993.md",
  "/api/fbaShipment/batchQuery/shipmentItemList.json": "FBA货件产品批量查询__api-328123046.md",
  "/api/order/api/report/fbaReturn/pageList.json": "FBA退货报告查询__api-116412069.md",
  "/api/order/api/report/fbm/return/order/pageList.json": "FBM退货报告查询__api-116412070.md",
  "/api/report/center/pageList.json": "Amazon原表下载-查询任务进度__api-52761475.md",
  "/api/inbound/getInboundPlan.json": "入库计划详情__api-250107681.md",
  "/api/warehouseInOut/inRecords.json": "其他入库列表页__api-199427642.md",
  "/api/warehouseInOut/outRecords.json": "其他出库列表页__api-74141061.md",
};

const WRITE_PATH = /\/(create|insert|update|delete|remove|add|modify|save|submit|cancel|close|approve|reject|audit|enable|disable|batch)[A-Za-z0-9_]*\.json$/i;
const SAFE_PATH = /^\/api\/[A-Za-z0-9_./-]{2,180}\.json$/;
const CODE = /^[a-z0-9][a-z0-9_-]{1,63}$/;

export function sellfoxEndpointCandidates(): SellfoxEndpointCandidate[] {
  const seededPaths = new Set(sellfoxKnownEndpoints().map(seed => seed.path));
  const items: SellfoxPlanItem[] = sellfoxPlanGroups.flatMap(group => group.items);
  const candidates: SellfoxEndpointCandidate[] = [];
  for (const item of items) {
    if (item.status !== "planned") continue; // live 已有内置同步器；blocked 缺平台授权，不做
    if (!CODE.test(item.id)) continue;
    const paths = item.api.filter(path => SAFE_PATH.test(path) && !WRITE_PATH.test(path));
    if (!paths.length) continue;
    candidates.push({
      code: item.id,
      label: item.label,
      priority: item.priority,
      paths,
      pathDocs: paths.map(path => ({ path, doc: PATH_DOCS[path] ?? null, seeded: seededPaths.has(path) })),
      paramsContract: "PENDING_API_CONTRACT",
      note: item.note ?? "请求参数名/分页字段需按赛狐接口文档或联调结果补齐后才能启用；不猜字段。",
    });
  }
  return candidates.sort((a, b) => a.priority.localeCompare(b.priority) || a.code.localeCompare(b.code));
}
