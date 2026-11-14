import { sellfoxSyncResources, type SellfoxSyncResource } from "./sync-contract";
import { syncResourceCadence as registryCadence, syncRuleChunkDays, sellfoxDateChunks } from "./sync-rules";

/** 节奏、分块、依赖统一由 sync-rules.ts 注册表派生；此处只保留页面展示用的文案与冷启动清单。 */
export { syncRuleChunkDays, sellfoxDateChunks };

/**
 * 同步编排定义：节奏、窗口、首跑顺序、分片键规则。
 *
 * 页面（/sellfox/sync）与 worker 共用这份定义，避免「页面写的节奏」和「实际跑的节奏」两套说法。
 * 分片断点已落到 SellfoxSyncShard（sync-shards.ts 负责 run 完成后的写入），
 * 运行中的断点仍在 SellfoxSyncRun.summary，run 完成时合并进分片。
 */

export type SyncCadence = "master" | "daily" | "document" | "monthly";

export type SyncCadenceRule = {
  id: SyncCadence;
  label: string;
  window: string;
  cron: string;
  description: string;
};

export const syncCadenceRules: SyncCadenceRule[] = [
  {
    id: "master",
    label: "主数据",
    window: "当前状态全量",
    cron: "每日 03:00",
    description: "店铺、子账号、汇率、SKU/SPU、分类、品牌、属性、仓库、货架位、供应商。按 updatedAt 优先 upsert。",
  },
  {
    id: "daily",
    label: "日事实",
    window: "T-7 ~ T-1 滚动重跑",
    cron: "每日 06:00",
    description: "销量、利润、FBA 库存、广告六类、小时样本。滚动重跑用于覆盖迟到数据。",
  },
  {
    id: "document",
    label: "单据",
    window: "按 updateTime 往前 2 小时（重叠 1 小时）",
    cron: "每 15 分钟",
    description: "订单、订单明细、退货、货件、货件产品、发货单、采购单、入库单、出入库、调整、调拨。",
  },
  {
    id: "monthly",
    label: "月财务",
    window: "当月 + 上月",
    cron: "每日 07:00（月结后补跑）",
    description: "结算、应收、发票、资金单据、按日利润、月利润。结算口径不能与日利润相加。",
  },
];

/** 冷启动顺序：后置数据集依赖前面的 storeId / sku / orderId，顺序不能乱。 */
export const syncFirstRunOrder: { resource: SellfoxSyncResource | null; label: string; reason: string }[] = [
  { resource: "stores", label: "店铺列表", reason: "所有事实表的外键来源" },
  { resource: null, label: "汇率 / 子账号", reason: "多币种汇总与归属维度的前置数据" },
  { resource: null, label: "分类 / 品牌 / 属性", reason: "商品主数据的字典" },
  { resource: null, label: "SKU / SPU 主数据", reason: "成本与款名的唯一来源" },
  { resource: "listings", label: "在线产品", reason: "商品维度与标题、图片" },
  { resource: "orders", label: "订单", reason: "订单号是明细与退货的父键" },
  { resource: null, label: "订单明细 / 退货", reason: "行级费用与退款，用于利润复算" },
  { resource: "inventory", label: "FBA 库存", reason: "库存与补货建议的底座" },
  { resource: null, label: "仓库 / 本地库存 / 流水 / 库龄", reason: "本地仓链路" },
  { resource: "fba_shipments", label: "货件", reason: "在途与签收" },
  { resource: null, label: "采购 / 供应商 / 入库单", reason: "采购链路" },
  { resource: null, label: "结算 / 应收", reason: "财务对账" },
  { resource: "performance", label: "产品日利润", reason: "利润页与经营分析" },
  { resource: "sales", label: "销量快照", reason: "销量统计与补货日均" },
  { resource: "ads_report", label: "广告报表（六类）", reason: "广告花费与产出" },
  { resource: null, label: "广告管理实体 / ABA", reason: "广告结构树与搜索词" },
];

/** 分片键规则：目标表落地后按这个粒度断点续跑。 */
export function syncShardScopeKey(resource: SellfoxSyncResource, input: { storeExternalId?: string; period?: string }) {
  const store = input.storeExternalId ? `store:${input.storeExternalId}` : "all";
  if (["inventory", "listings", "stores"].includes(resource)) return store;
  if (["sales", "performance", "hourly", "orders", "fba_shipments"].includes(resource)) return input.period ? `${store}|${input.period}` : store;
  return input.period ? `${store}|${input.period}` : store;
}

/** 每个资源的节奏归属，用于页面分组与 worker 调度。 */
export const syncResourceCadence: Record<SellfoxSyncResource, SyncCadence> = registryCadence;


export function syncCadenceGroups() {
  return syncCadenceRules.map((rule) => ({
    ...rule,
    resources: sellfoxSyncResources.filter((resource) => syncResourceCadence[resource] === rule.id),
  }));
}
