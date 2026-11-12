# Wimoor 移植缺口与下一批页面

本文件由固定 729 项矩阵生成；不是新开发完成报告。

## 关键缺口

- 菜单证据：动态菜单由 Wimoor 服务端提供；729 项均记录未核验菜单，不根据文件夹虚构菜单名称或路由。
- 全量对等：当前仅显式适配文件进入接入统计，其余候选路由不算完成；全部 729 项均未宣称完整源文件功能对等或用户验收。
- Amazon 入库：本地计划/装箱与外部快照不等于 Amazon 创建计划、确认装箱、购买标签和发货写入。
- FBA 货件列表：Wimoor shipv2 货件列表/筛选/表格结构映射到 ERP `/operations?view=fulfillment` 已发布观察查询，保留计划→货件→商品下钻、来源版本、分页、筛选与 Amazon 状态标签；仅在获批计划范围内只读展示。上游阶段状态 Tab、高级物流筛选、写操作和实际接收数量均不在现有 API/快照范围内，保持未接入。
- FBA 运输/报关：Wimoor 运输与报关布局复用现有本地 FBA 工作台的货代委托、人工轨迹、报关草稿、复核和清关节点服务；不是承运商 API、海关直连或 Amazon 履约操作。税率/产品材质/费用公式、发票模板、重量体积计费历史仍缺失。
- 财务：交易查询不等于总账、凭证、关账；通用请款/报销/核销缺少 API、Service 与模型。采购付款退款和 FBA 费用沿独立服务。
- 地址、VAT、Transparency、利润方案、可编辑 FBA 费用公式、第三方物流凭证等，现有相关入口不能替代独立业务生命周期。
- 调拨：状态筛选、单据表格、详情和草稿明细布局已适配；UI fixture 已通过。打印、导入及完整审计时间线未移植。
- WMS 收货/出库/盘点：本批补齐收货建档与详情、出库需求草稿列表/详情/产品选择、库位批次盘点列表/实盘输入；均沿用 ERP WMS 服务。隔离浏览器只验证组件/API 形状，不是数据库业务链验收；批量导入导出、直接库存回滚、海外仓盘点、打印等仍未移植。
- 子组件：父页适配不代表打印、批量导入导出、专属弹窗和业务动作全部移植；请按每行 dependencies 与 remainingFeatures 继续推进。

## 下一批可直接复用服务的文件

| 原始文件 | 功能 | 现有服务/入口 | 实施边界 |
| --- | --- | --- | --- |
| `src/views/erp/purchase/orders/components/sku_table_inner_dailog.vue` | 采购明细内层对话框 | /operations?view=purchase-orders；`src/lib/procurement/query-service.ts` | 只移植已存在 ERP 收货/采购动作；拒绝上游库存逆向或不支持的实物回滚 |
| `src/views/erp/purchase/orders/components/change_records.vue` | 采购变更记录弹窗 | /operations?view=purchase-orders；`src/lib/procurement/query-service.ts` | 检查是否有不可变采购审计数据；无等价事实源前仅记录缺口，不伪造历史 |
| `src/views/erp/warehouse/inbound/components/create_dialog.vue` | 采购/库存商品选择弹窗 | /logistics/warehouse?tab=warehouses；`src/lib/wms/query-service.ts` | ERP 表单按已建批次收货，不在无统一可用库存和采购成本接口时补造上游列 |

## 验证与复跑

`python3 scripts/wimoor/build-migration-matrix.py` 仅读取固定清单列出的源文件和路由；源哈希不一致即失败，不修改原清单。验证 729 个唯一键、路由组件对应、依赖路径、ERP 引用存在、状态与统计不变量，以及原 JSON/Markdown 字节哈希保持不变。

继续移植已修改 UI 并运行隔离浏览器测试；本轮范围与结果见 [delivery.md](delivery.md) 的最新“FBA 货件与运输/报关结构续接”小节。此前临时数据库集成在既有 `20261130010000_finance_ledger` 脚本处因 PostgreSQL 同参数函数 `finance_voucher_line_guard` 重复声明而失败，未进入新增页面验证；未修改该并行迁移，也未操作真实业务数据库或 Amazon。

本批新增/修改文件及测试结果见 [delivery.md](delivery.md)。未提交、未推送、未部署。
