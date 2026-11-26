'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「销售 → FBA报表 → FBA费用」功能迁移。
 * 源组件：amazon/report/fba_fee/index.vue
 * 还原列口径：图片(img)、商品信息(product)、参数类型(QuantityOrdered)、尺寸长宽高cm(total_price)、
 * 重量kg(sweight)、价格(price)、尺寸分段、FBA收费每月预计超收费用(overcharge)、更新时间。
 * 说明：等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /amazon/fees）。
 * 注：源表存在同名字段 price，本页拆分为 price/sizeTier/updateTime 以保证列键唯一，标签保持源口径。
 */

/**
 * 本页已从原「主数据口径对照入口」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/sales/fba-feiyong" fallbackTitle="FBA费用" />;
}
