---
name: skill-erp
description: 通过已连接的 ERP MCP 查询授权店铺的商品、库存、销售和广告数据，说明来源、范围和数据新鲜度，并基于查询结果提出建议。
---

# ERP MCP 查询

先检查本次对话实际可调用的 MCP 工具。网页工具目录、Skill 文本、数据库有数据都不能证明客户端已经连接。缺少工具时说明连接阻断；不以直接 SQL、Cookie API 或网页截图替代 MCP 验收。

## 选择范围与工具

- 从实际发现的 `amazon.stores.list` 获取授权的店铺和站点配对；使用返回的 ERP `sellerAccountId`，不要把 Amazon Seller ID 当作 ERP 内部 ID。存在多个符合条件的店铺时再向用户澄清。
- 用 `data_list_tables`、`data_describe_table` 和 `data_sync_status` 确认可用逻辑表、字段、粒度、日期语义及同步状态；参数以本次工具 schema 为准。目录可见不代表已发布数据可用。
- 首次查询优先用 `data_query` 的单店铺、单站点和 `pageSize: 3`。例如 inventory 表使用 `table`、`sellerAccountId`、`marketplaceId`、`page` 和 `pageSize`。分清结果分页与汇总，不能把前三行称为全店总量。
- 销售必须说明日期范围。`sales_traffic_daily` 是店铺逐日数据，不提供 SKU/ASIN 销售拆分。库存和商品是快照，`capturedAt` 不等于销售日期范围。
- 广告必须检查独立广告工具授权和 Profile 范围；通用 `data_query` 授权不代表广告授权。按 schema 区分 ERP Profile 内部 ID 与 Amazon Profile ID，不跨店铺或站点推断 Profile。保留币种、时区、报表类型和归因窗口，避免混算。

## 失败与操作边界

遇到 401、403、撤权、断连、停用或超时，停止依赖该数据的结论并说明阻断。旧结果只能明确标为历史查询结果，不作为本次新查询。

读取验收不调用 `data_sync_start`：该工具会写入审批申请。过期或缺失数据先报告，不自动同步、导出或修改上游数据。优化建议仅基于实际读到的证据；执行修改需另行授权。

卖家精灵与西柚需各自真实连接并使用各自工具；不把 ERP 数据冒充外部来源。某来源不可用时说明建议缺少哪些证据。

## 回答与结果回读

每次返回说明店铺、Marketplace、数据来源、查询时间及其时区、报告日期范围或快照时间，并保留可用的 requestId、同步批次/版本及 warnings。金额保留原币种与精度。缺失元数据标为未知，不自行补造。

区分“数据事实”和“优化建议”。如果用户授权了保存结果，保存后通过对应工具重新读取并核对；没有结果保存工具时交付对话中的建议，明确尚未写回 ERP。
