'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「账目 → 平台账目 → 店铺利润」口径对照入口。
 * 源组件：amazon/payment/profitReport/profitGroup/index.vue（店铺利润 / 月度结算 / 月度结算简洁版）。
 * 等价页已存在：/sellfox/profit，本页为 WIMOOR 口径对照入口。
 * 还原交互：店铺/站点搜索、币种筛选、店铺维度销售额-成本-广告-利润核心列、分页；
 * 图表与月度结算明细保留在等价页，不臆造净利润。
 */

/**
 * 本页已从原「主数据口径对照入口」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/account/shop-profit" fallbackTitle="店铺利润" />;
}
