import { defaultRules, lifecycleGroups } from "@/data/default-rules";
import { aggregateMetrics } from "@/lib/metrics";
import type { CampaignGroup, DataBatch, PerformanceRow, TrendPoint } from "@/lib/types";

const mockSheetName = "商品推广活动";

export const campaignGroups: CampaignGroup[] = [
  {
    id: "mock-sheet-core",
    sheetName: mockSheetName,
    campaignName: "SP-US-Core-Espresso",
    adGroupName: "便携咖啡机-核心词",
    lifecycleGroupId: "launch",
    keywordCount: 426,
    lastUpdated: "2026-06-17",
  },
  {
    id: "mock-sheet-auto",
    sheetName: mockSheetName,
    campaignName: "SP-US-Auto-Discovery",
    adGroupName: "自动投放-新品探索",
    lifecycleGroupId: "launch",
    keywordCount: 388,
    lastUpdated: "2026-06-16",
  },
  {
    id: "mock-sheet-scale",
    sheetName: mockSheetName,
    campaignName: "SP-US-Scale-Exact",
    adGroupName: "成熟爆款-精准放量",
    lifecycleGroupId: "mature",
    keywordCount: 712,
    lastUpdated: "2026-06-17",
  },
  {
    id: "mock-sheet-competitor",
    sheetName: mockSheetName,
    campaignName: "SP-US-Competitor",
    adGroupName: "竞品词-成熟期",
    lifecycleGroupId: "mature",
    keywordCount: 284,
    lastUpdated: "2026-06-15",
  },
  {
    id: "mock-sheet-defense",
    sheetName: mockSheetName,
    campaignName: "SP-US-Defense",
    adGroupName: "品牌防守-衰退",
    lifecycleGroupId: "decline",
    keywordCount: 198,
    lastUpdated: "2026-06-14",
  },
  {
    id: "mock-sheet-longtail",
    sheetName: mockSheetName,
    campaignName: "SP-US-Longtail",
    adGroupName: "长尾词-衰退期",
    lifecycleGroupId: "decline",
    keywordCount: 532,
    lastUpdated: "2026-06-13",
  },
  {
    id: "mock-sheet-clearance",
    sheetName: mockSheetName,
    campaignName: "SP-US-Clearance",
    adGroupName: "清库存-广泛词",
    lifecycleGroupId: "clearance",
    keywordCount: 341,
    lastUpdated: "2026-06-12",
  },
  {
    id: "mock-sheet-coupon",
    sheetName: mockSheetName,
    campaignName: "SP-US-Coupon-Push",
    adGroupName: "优惠券-清库存",
    lifecycleGroupId: "clearance",
    keywordCount: 229,
    lastUpdated: "2026-06-11",
  },
];

const batchTemplates = [
  ["b-1", "2026-05-01 至 2026-05-07", "所有日期广告数据_0507.xlsx"],
  ["b-2", "2026-05-08 至 2026-05-14", "所有日期广告数据_0514.xlsx"],
  ["b-3", "2026-05-15 至 2026-05-21", "所有日期广告数据_0521.xlsx"],
  ["b-4", "2026-05-22 至 2026-05-28", "所有日期广告数据_0528.xlsx"],
  ["b-5", "2026-05-29 至 2026-06-04", "所有日期广告数据_0604.xlsx"],
  ["b-6", "2026-06-05 至 2026-06-11", "所有日期广告数据_0611.xlsx"],
] as const;

export const dataBatches: DataBatch[] = campaignGroups.flatMap((group, groupIndex) =>
  batchTemplates.slice(groupIndex % 2, groupIndex % 2 + 4).map(([batchId, dateRange, fileName], index) => ({
    id: `${group.id}-${batchId}`,
    campaignGroupId: group.id,
    fileName,
    uploadedAt: `2026-06-${String(10 + index + groupIndex).padStart(2, "0")} 10:3${index}`,
    rowCount: 18420 + groupIndex * 1240 + index * 870,
    dateRange,
    status: "archived",
  })),
);

const keywordSeeds = [
  "portable espresso maker",
  "travel coffee machine",
  "mini espresso machine",
  "camping coffee maker",
  "rechargeable espresso",
  "single serve espresso",
  "coffee maker for office",
  "espresso accessories",
  "compact coffee brewer",
  "manual espresso press",
];

export const performanceRows: PerformanceRow[] = campaignGroups.flatMap((group, groupIndex) => {
  const groupBatches = dataBatches.filter((batch) => batch.campaignGroupId === group.id);

  return groupBatches.flatMap((batch, batchIndex) =>
    Array.from({ length: 10 }, (_, rowIndex) => {
      const seed = groupIndex * 17 + batchIndex * 11 + rowIndex;
      const impressions = seed % 13 === 0 ? 0 : 900 + seed * 143;
      const clicks = impressions === 0 ? 0 : 8 + ((seed * 7) % 96);
      const orders = seed % 9 === 0 ? 0 : (seed * 3) % 18;
      const spend = Number((clicks * (0.52 + (seed % 8) * 0.09)).toFixed(2));
      const sales = Number((orders * (21 + (seed % 6) * 5.5)).toFixed(2));
      const sourceRowIndex = 2 + groupIndex * 160 + batchIndex * 10 + rowIndex;

      return {
        id: `${batch.id}-r-${rowIndex}`,
        campaignGroupId: group.id,
        batchId: batch.id,
        sheetName: group.sheetName,
        sourceRowIndex,
        sourceRowNumber: sourceRowIndex,
        entity: "关键词",
        adGroupNameRef: group.adGroupName,
        campaignName: group.campaignName,
        adGroupName: group.adGroupName,
        keyword: keywordSeeds[(rowIndex + groupIndex) % keywordSeeds.length],
        target: rowIndex % 3 === 0 ? `asin=B0${seed}X${rowIndex}` : keywordSeeds[rowIndex],
        matchType: ["Exact", "Phrase", "Broad", "Auto"][rowIndex % 4],
        currentBid: Number((0.65 + (seed % 12) * 0.11).toFixed(2)),
        impressions,
        clicks,
        orders,
        sales,
        spend,
        topOfSearchShare: Number((12 + (seed % 70)).toFixed(1)),
        advertisedProductOrders: Math.max(0, orders - (seed % 3)),
        otherProductOrders: seed % 3,
        viewableImpressions: Math.floor(impressions * (0.62 + (seed % 4) * 0.06)),
        status: seed % 19 === 0 ? "paused" : "enabled",
      };
    }),
  );
});

export const metricSnapshots = dataBatches.map((batch) =>
  aggregateMetrics(batch.campaignGroupId, batch.id, performanceRows),
);

export const trendPoints: TrendPoint[] = Array.from({ length: 18 }, (_, index) => ({
  date: `06-${String(index + 1).padStart(2, "0")}`,
  sales: 1800 + index * 118 + (index % 3) * 240,
  spend: 520 + index * 34 + (index % 4) * 52,
  acos: 22 + (index % 5) * 2.8,
  roas: 3.1 + (index % 4) * 0.32,
  orders: 48 + index * 3 + (index % 6),
}));

export { defaultRules, lifecycleGroups };
