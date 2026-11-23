
import { type HostPage, type HostDataset, type HostColumn, type HostTabGroup, storeColumn, adsMetrics } from "./host-page-schema";
import { advancedMetricPreviewColumns, advancedMetricsSummary } from "./ads-advanced-metrics";

/**
 * 阶段2「实体全量拉回」拉入 21 类 CPC 管理实体当前状态（SellfoxApiRecord, endpointCode=ads_ent_*）。
 * 阶段3统一查询：走既有 rawCode 动态列通道读取真实 payload，字段按真实键派生、不猜字段、不补零。
 * 实体是「当前状态快照」，无日期维度、不与六类广告日报相加；sp/sb/sd 是各自独立端点，不需 adType 筛选。
 * 这里只声明数据合同与端点映射；真实列由后端 deriveRawColumns 按 payload 键动态返回（columns 仅供预览兜底）。
 */
const ADS_ENTITY_SPECS: Array<{ code: string; label: string; path: string; note: string }> = [
  { code: "ads_ent_portfolio", label: "广告组合", path: "portfolio", note: "广告组合当前实体：组合 ID、名称、状态、预算类型/金额与时间范围。组合预算不与活动花费相加。" },
  { code: "ads_ent_sp_campaign", label: "SP 活动", path: "spCampaign", note: "SP 活动当前实体：活动 ID、名称、状态、服务状态、竞价策略、预算、日期。实体当前配置非历史每日值。" },
  { code: "ads_ent_sp_group", label: "SP 广告组", path: "spGroup", note: "SP 广告组当前实体：组 ID、父活动、状态、默认竞价。一个组只属于其真实父级。" },
  { code: "ads_ent_sp_ad_product", label: "SP 广告产品", path: "spAdProduct", note: "SP 广告产品当前实体：产品广告 ID、父活动/组、ASIN/SKU、状态。" },
  { code: "ads_ent_sp_target", label: "SP 投放", path: "spTarget", note: "SP 商品投放当前实体：投放 ID、表达式、匹配类型、竞价、状态、父级关系。" },
  { code: "ads_ent_sp_keyword", label: "SP 关键词投放", path: "spKeyword", note: "SP 关键词投放当前实体：关键词 ID、词、匹配类型、竞价、状态、父级关系。" },
  { code: "ads_ent_sp_ne_keyword", label: "SP 否定关键词", path: "spNeKeyword", note: "SP 否定关键词当前实体：否定词 ID、词、匹配方式、层级、父级。真实空集合时显示暂无数据，不伪造。" },
  { code: "ads_ent_sp_ne_target", label: "SP 否定商品投放", path: "spNeTarget", note: "SP 否定商品投放当前实体：否定投放 ID、表达式、层级、父级。真实空集合时显示暂无数据，不伪造。" },
  { code: "ads_ent_sb_campaign", label: "SB 活动", path: "sbCampaign", note: "SB 活动当前实体：活动 ID、名称、状态、预算、日期。" },
  { code: "ads_ent_sb_group", label: "SB 广告组", path: "sbGroup", note: "SB 广告组当前实体：组 ID、父活动、状态、默认竞价。" },
  { code: "ads_ent_sb_ad_product", label: "SB 广告产品", path: "sbAdProduct", note: "SB 广告产品当前实体：产品广告 ID、父活动/组、状态。" },
  { code: "ads_ent_sb_target", label: "SB 投放", path: "sbTarget", note: "SB 投放当前实体：投放 ID、表达式、匹配类型、竞价、状态。" },
  { code: "ads_ent_sb_keyword", label: "SB 关键词投放", path: "sbKeyword", note: "SB 关键词投放当前实体：关键词 ID、词、匹配类型、竞价、状态。" },
  { code: "ads_ent_sb_ne_keyword", label: "SB 否定关键词", path: "sbNeKeyword", note: "SB 否定关键词当前实体。真实空集合时显示暂无数据，不伪造。" },
  { code: "ads_ent_sb_ne_target", label: "SB 否定商品投放", path: "sbNeTarget", note: "SB 否定商品投放当前实体。实测真实空集合，显示暂无数据属正确结果。" },
  { code: "ads_ent_sd_campaign", label: "SD 活动", path: "sdCampaign", note: "SD 活动当前实体：活动 ID、名称、状态、预算、日期。" },
  { code: "ads_ent_sd_group", label: "SD 广告组", path: "sdGroup", note: "SD 广告组当前实体：组 ID、父活动、状态、默认竞价。" },
  { code: "ads_ent_sd_ad_product", label: "SD 广告产品", path: "sdAdProduct", note: "SD 广告产品当前实体：产品广告 ID、父活动/组、状态。" },
  { code: "ads_ent_sd_creative", label: "SD 创意", path: "sdCreative", note: "SD 创意当前实体：创意 ID、关联广告、状态。" },
  { code: "ads_ent_sd_target", label: "SD 投放", path: "sdTarget", note: "SD 商品投放当前实体：投放 ID、表达式、竞价、状态。" },
  { code: "ads_ent_sd_ne_target", label: "SD 否定商品投放", path: "sdNeTarget", note: "SD 否定商品投放当前实体。实测真实空集合，显示暂无数据属正确结果。" },
];

function adsEntityDataset(spec: { code: string; label: string; path: string; note: string }): HostDataset {
  const previewColumns: HostColumn[] = [storeColumn, { key: "state", label: "状态" }, { key: "name", label: "名称" }, { key: "_syncedAt", label: "同步时间", kind: "date" }];
  return {
    id: spec.code,
    label: spec.label,
    status: "live",
    priority: "P1",
    table: "SellfoxApiRecord",
    rawCode: spec.code,
    api: [`/api/cpc/manageData/${spec.path}.json`],
    grain: "当前状态全量快照（实体当前配置，非按日报表）",
    note: spec.note,
    columns: previewColumns,
    searchable: true,
    dateRange: false,
    // 真实 payload 均含 state（enabled/paused/archived），servingStatus 为大写枚举；
    // 二者并存，筛选只按 state，不覆盖 servingStatus。
    stateFilter: true,
  };
}

const ADS_ENTITY_DATASETS: HostDataset[] = ADS_ENTITY_SPECS.map(adsEntityDataset);

/**
 * 一级分组：对齐赛狐广告页可见的 10 个管理标签，并保留小时曲线、ABA 与高级指标入口。
 * 每个分组只引用既有 dataset id，不改变读取路径、落表或 URL 参数（向后兼容）。
 * 标签说明来自冻结合同（/workspace/赛狐广告页对标-冻结合同-2026-11-23.md）与完整方案 §1-§13。
 */
const ADS_TAB_GROUPS: HostTabGroup[] = [
  { id: "portfolio", label: "广告组合", datasetIds: ["ads_ent_portfolio"], status: "live", evidence: "实见", note: "组合当前态：ID/名称/预算策略/金额/起止日期/状态。组合预算不与活动花费相加。" },
  { id: "campaign", label: "广告活动", datasetIds: ["ads_ent_sp_campaign", "ads_ent_sb_campaign", "ads_ent_sd_campaign", "ads_campaign"], status: "live", evidence: "实见", note: "上排三个为活动当前配置（无日期），下排为活动按日日报；两者不相加。" },
  { id: "adgroup", label: "广告组", datasetIds: ["ads_ent_sp_group", "ads_ent_sb_group", "ads_ent_sd_group", "ads_ad_group"], status: "live", evidence: "实见", note: "组当前态含父活动与默认竞价；日报为按日表现。" },
  { id: "adproduct", label: "广告产品", datasetIds: ["ads_ent_sp_ad_product", "ads_ent_sb_ad_product", "ads_ent_sd_ad_product", "ads_product"], status: "live", evidence: "实见", note: "广告产品当前态 + 按日商品日报。" },
  { id: "targeting", label: "投放", datasetIds: ["ads_ent_sp_target", "ads_ent_sp_keyword", "ads_ent_sb_target", "ads_ent_sb_keyword", "ads_ent_sd_target", "ads_targeting"], status: "live", evidence: "实见", note: "商品投放/关键词当前竞价、表达式与状态 + 投放日报；SD 投放仅商品投放。" },
  { id: "searchterm", label: "搜索词", datasetIds: ["ads_search_term"], status: "live", evidence: "实见", note: "仅区间日报聚合；搜索词不是投放实体，不同来源投放可共存。" },
  { id: "negative", label: "否定投放", datasetIds: ["ads_ent_sp_ne_keyword", "ads_ent_sp_ne_target", "ads_ent_sb_ne_keyword", "ads_ent_sb_ne_target", "ads_ent_sd_ne_target"], status: "live", evidence: "实见", note: "否定关键词/否定商品投放当前态；sb_ne_target 与 sd_ne_target 为真实空集合，显示暂无数据属正确结果。" },
  { id: "placement", label: "广告位", datasetIds: ["ads_placement"], status: "live", evidence: "实见", note: "广告位表现日报，当前仅 SP 有数据；无广告位调整配置端点，SB/SD 覆盖待验证。" },
  { id: "amc", label: "AMC", datasetIds: [], status: "blocked", evidence: "实见", note: "无登记端点、无本地表；保持未开通，不伪造人群对象、字段或操作。" },
  { id: "log", label: "广告日志", datasetIds: [], status: "live", evidence: "代码", href: "/sellfox?domain=runs", note: "复用同步日志（domain=runs），非广告专属日志 API；不创建新任务、不下载日志。" },
  { id: "ops", label: "优化方案", datasetIds: [], status: "live", evidence: "设计", proposals: true, note: "可审计写操作：生成方案→业务审批→受闸门执行。未授权/transport 未实现时一律返回未执行，绝不伪造成功。" },
  { id: "hourly", label: "小时曲线", datasetIds: ["hourly"], status: "live", evidence: "实见", note: "按小时×活动，仅 SP；为空表示尚未采集，不是 0。保留现有入口。" },
  { id: "aba", label: "ABA 搜索词", datasetIds: ["aba"], status: "planned", evidence: "代码", note: "尚未建立 SellfoxAbaSearchTerm 表，保持 planned 入口，不填 0。" },
  { id: "advanced", label: "高级指标", datasetIds: ["ads_advanced_metrics"], status: "live", evidence: "实见", note: "生产已有的高级指标字段合同预览（待接）；不产出数值、不填 0，保留原有入口。" },
];

export const adsHostPage: HostPage = {
    id: "ads",
    href: "/sellfox/ads",
    title: "广告报表",
    subtitle: "赛狐 CPC 六类日报 + 21 类管理实体当前状态 + 小时曲线 + ABA 搜索词。只读快照，不在浏览器里拉广告接口。",
    source: "赛狐广告快照",
    groups: ADS_TAB_GROUPS,
    datasets: [
      {
        id: "ads_product",
        label: "产品报表",
        status: "live",
        priority: "P0",
        table: "SellfoxAdsProductDaily",
        api: ["/api/cpc/download/createTask.json", "/api/cpc/download/pageList.json"],
        grain: "按日 × 店铺 × 广告类型",
        note: "广告维度到商品（ASIN/MSKU），是广告归因最细的日报。",
        reader: "ads_product",
        columns: [
          storeColumn,
          { key: "reportDate", label: "日期", kind: "date" },
          { key: "adType", label: "类型" },
          { key: "asin", label: "ASIN" },
          { key: "msku", label: "MSKU" },
          ...adsMetrics,
        ],
        searchable: true,
        dateRange: true,
        adType: true,
      },
      {
        id: "ads_campaign",
        label: "活动报表",
        status: "live",
        priority: "P0",
        table: "SellfoxAdsCampaignDaily",
        api: ["/api/cpc/download/createTask.json"],
        grain: "按日 × 活动",
        note: "活动级花费与产出，用于判断预算是否打偏。",
        reader: "ads_campaign",
        columns: [
          storeColumn,
          { key: "reportDate", label: "日期", kind: "date" },
          { key: "adType", label: "类型" },
          { key: "campaignName", label: "活动名称", kind: "stack" },
          ...adsMetrics,
        ],
        searchable: true,
        dateRange: true,
        adType: true,
      },
      {
        id: "ads_ad_group",
        label: "广告组报表",
        status: "live",
        priority: "P1",
        table: "SellfoxAdsAdGroupDaily",
        api: ["/api/cpc/download/createTask.json"],
        grain: "按日 × 广告组",
        note: "广告组级；含组内主投放词与匹配方式。",
        reader: "ads_ad_group",
        columns: [
          storeColumn,
          { key: "reportDate", label: "日期", kind: "date" },
          { key: "adType", label: "类型" },
          { key: "adGroupName", label: "广告组", kind: "stack" },
          { key: "targetingText", label: "主投放词" },
          { key: "matchType", label: "匹配方式" },
          ...adsMetrics,
        ],
        searchable: true,
        dateRange: true,
        adType: true,
      },
      {
        id: "ads_targeting",
        label: "投放报表",
        status: "live",
        priority: "P1",
        table: "SellfoxAdsTargetingDaily",
        api: ["/api/cpc/download/createTask.json"],
        grain: "按日 × 投放",
        note: "关键词/商品投放粒度，是加否词与调价的依据。",
        reader: "ads_targeting",
        columns: [
          storeColumn,
          { key: "reportDate", label: "日期", kind: "date" },
          { key: "adType", label: "类型" },
          { key: "targetingText", label: "投放词", kind: "stack" },
          { key: "matchType", label: "匹配方式" },
          ...adsMetrics,
        ],
        searchable: true,
        dateRange: true,
        adType: true,
      },
      {
        id: "ads_placement",
        label: "广告位报表",
        status: "live",
        priority: "P2",
        table: "SellfoxAdsPlacementDaily",
        api: ["/api/cpc/download/createTask.json"],
        grain: "按日 × 广告位",
        note: "商品页/搜索结果顶部等位置差异，用于判断溢价方向。",
        reader: "ads_placement",
        columns: [
          storeColumn,
          { key: "reportDate", label: "日期", kind: "date" },
          { key: "adType", label: "类型" },
          { key: "placement", label: "广告位" },
          { key: "campaignId", label: "活动 ID" },
          ...adsMetrics,
        ],
        searchable: true,
        dateRange: true,
        adType: true,
      },
      {
        id: "ads_search_term",
        label: "搜索词报表",
        status: "live",
        priority: "P1",
        table: "SellfoxAdsSearchTermDaily",
        api: ["/api/cpc/download/createTask.json"],
        grain: "按日 × 搜索词",
        note: "顾客实际搜索词，用于拓词与否定。",
        reader: "ads_search_term",
        columns: [
          storeColumn,
          { key: "reportDate", label: "日期", kind: "date" },
          { key: "adType", label: "类型" },
          { key: "searchTerm", label: "搜索词", kind: "stack" },
          { key: "matchType", label: "匹配方式" },
          ...adsMetrics,
        ],
        searchable: true,
        dateRange: true,
        adType: true,
      },
      // 阶段2「实体全量拉回」已把 21 类管理实体拉入 SellfoxApiRecord（endpointCode=ads_ent_*），
      // 阶段3统一查询走既有 rawCode 动态列通道读取真实 payload：按店铺授权收窄、字段按真实键派生、
      // 不猜字段、不补零、不与六类广告日报相加。实体是「当前状态快照」，无日期维度，故 dateRange=false。
      ...ADS_ENTITY_DATASETS,
      {
        id: "hourly",
        label: "小时曲线",
        status: "live",
        priority: "P2",
        table: "SellfoxHourlyMetric",
        api: ["/api/cpc/hourData/spCampaign.json"],
        grain: "按小时 × 活动（仅 SP）",
        note: "SB/SD 小时报告尚未接入，因此本 tab 只有 SP 活动级样本；为空表示尚未采集，不是 0。",
        reader: "hourly",
        columns: [
          storeColumn,
          { key: "reportDate", label: "日期", kind: "date" },
          { key: "hour", label: "小时", kind: "qty" },
          { key: "entityType", label: "层级" },
          { key: "entityName", label: "实体" },
          { key: "impressions", label: "曝光量", kind: "qty" },
          { key: "clicks", label: "点击量", kind: "qty" },
          { key: "cost", label: "花费", kind: "money" },
        ],
        searchable: true,
        dateRange: true,
      },
      {
        id: "aba",
        label: "ABA 搜索词",
        status: "planned",
        priority: "P1",
        table: "SellfoxAbaSearchTerm",
        api: ["/api/cpc/searchTerms/pageList.json"],
        grain: "按周 × 搜索词",
        note: "品牌分析搜索词排名与点击份额，用于站外与选品验证。",
        columns: [
          storeColumn,
          { key: "reportDate", label: "周", kind: "date" },
          { key: "searchTerm", label: "搜索词" },
          { key: "rank", label: "排名", kind: "qty" },
          { key: "clickShare", label: "点击份额", kind: "rate" },
          { key: "conversionShare", label: "转化份额", kind: "rate" },
        ],
        searchable: true,
        dateRange: true,
      },
      {
        id: "ads_advanced_metrics",
        label: "高级指标（待接）",
        status: "blocked",
        priority: "P2",
        table: "—（未落表，仅登记字段合同）",
        api: ["/api/cpc/download/createTask.json"],
        grain: "不适用（尚未接入，无数据行）",
        note: (() => {
          const s = advancedMetricsSummary();
          return `赛狐活动列设置实见的高级指标共 ${s.total} 项（待验证 ${s.pending}、未决 ${s.unresolved}、已启用 ${s.enabled}）。这些指标需来源字段、样本、适用广告类型、归因窗口与聚合口径核实后才能启用；ACoTS/ASoTS/ACoAS/ASoAS 的分子、分母、广告范围与名称不凭缩写猜测。当前一律不产出数值、不填 0、不用相似指标冒充；下方仅为字段样式预览。`;
        })(),
        columns: advancedMetricPreviewColumns(),
        searchable: false,
        dateRange: false,
      },
    ],
  };
