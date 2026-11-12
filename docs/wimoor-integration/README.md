# Wimoor 业务研究与融合入口

2026-11-12 用户目标与当前研究入口：[全业务提取与融合执行约束](research-execution-contract-2026-11-12.md)。按真实实现提取全部可识别业务，再逐能力对照、验证和融合；区分 Wimoor 原始能力、ERP 当前实现及目标扩展，保留现有技术架构与事实源。本次已复核 9,082 个源文件摘要，并追加[采购付款源码与目标差异](procurement-payment-research-2026-11-12.md)；全域语义提取尚未完成。下方首轮域级状态有历史时点，不能替代当前代码或该增量研究。

当前 WMS 能力映射、可执行状态转换、异常恢复及事件契约见 [WMS 能力与契约](wms-capability-contract.md)。历史设计/验证状态保留为各自时点记录；当前已实现及待接入边界以该补充和对应代码为准。

更新日期：2026-11-11。目标是将经源码核实、适合公司的业务能力融入当前 Next.js/TypeScript/Prisma/PostgreSQL ERP；不迁移 Wimoor 技术架构或整库。

最新增量：[2026-11-12 三阶段首批来源交接开发](three-stage-delivery-2026-11-12.md)，包含 FBA/WMS 到正式总账草稿、独立审核/过账、幂等与关账覆盖范围；完整三阶段余项见其中任务链接。

## 输入与证据

- Wimoor 源码目录：`/Users/chenjieliang/Documents/wimoor/`
- Git 基线：`8f894b1eccb8df5d16af19a75c6a517795bf02a5`（2026-06-24）；源目录不是 clean checkout。结论基于扫描时工作树，逐文件摘要与源改动清单见 [evidence/summary.json](evidence/summary.json) 和 [evidence/files.json](evidence/files.json)。
- 当前 ERP：本目录的同级仓库工作树，含大量既有未提交改动。此研究不把这些改动当作本轮新建，也不覆盖它们。
- MIT 根许可证副本：[WIMOOR-LICENSE.txt](WIMOOR-LICENSE.txt)。第三方依赖/代码授权仍须按具体实现复核。
- 提取边界、解析例外、统计口径与 API 限制：[源码证据索引](wimoor-source-evidence-index.md)。

## 交付地图

机器清单、字段和源文件级证据是检索入口，不等于每项业务规则都已人工验证。13 个工作簿共 154,287 数据行、26 张表；其中字段目录逐列保留 SQL 与 Entity 字段候选。Excel 清单及复现方式见[索引的交付章节](wimoor-source-evidence-index.md#交付与复现)。重点文件：

- 全部 SQL 字段、Entity 字段候选：[wimoor-column-inventory.xlsx](../../outputs/wimoor-p0a-20261111/wimoor-column-inventory.xlsx)
- 表身份、重复/冲突、引用候选：[wimoor-table-inventory.xlsx](../../outputs/wimoor-p0a-20261111/wimoor-table-inventory.xlsx)
- 约束及索引列序：[wimoor-index-constraint-inventory.xlsx](../../outputs/wimoor-p0a-20261111/wimoor-index-constraint-inventory.xlsx)
- Service/方法、Mapper 与调用候选：[wimoor-service-method-inventory.xlsx](../../outputs/wimoor-p0a-20261111/wimoor-service-method-inventory.xlsx)、[wimoor-service-call-graph.xlsx](../../outputs/wimoor-p0a-20261111/wimoor-service-call-graph.xlsx)
- 调度/API/模块依赖：[wimoor-scheduler-inventory.xlsx](../../outputs/wimoor-p0a-20261111/wimoor-scheduler-inventory.xlsx)、[wimoor-api-inventory.xlsx](../../outputs/wimoor-p0a-20261111/wimoor-api-inventory.xlsx)、[wimoor-module-dependency.xlsx](../../outputs/wimoor-p0a-20261111/wimoor-module-dependency.xlsx)
- 初始能力、Prisma 字段和 Amazon API 对照：[erp-existing-capability-matrix.xlsx](../../outputs/wimoor-p0a-20261111/erp-existing-capability-matrix.xlsx)、[prisma-model-mapping.xlsx](../../outputs/wimoor-p0a-20261111/prisma-model-mapping.xlsx)、[sp-api-modernization-matrix.xlsx](../../outputs/wimoor-p0a-20261111/sp-api-modernization-matrix.xlsx)、[ads-api-modernization-matrix.xlsx](../../outputs/wimoor-p0a-20261111/ads-api-modernization-matrix.xlsx)
- 业务规则初始目录：[wimoor-business-rules.xlsx](../../outputs/wimoor-p0a-20261111/wimoor-business-rules.xlsx)；其人工 VERIFIED 规则当前集中于 WMS，公式证据另见[公式目录](formula-evidence.md)。
- 首个 WMS 闭环变更范围：[p0b-wms-change-list.md](p0b-wms-change-list.md)；本地隔离验证状态：[verification.json](verification.json)。
- 三模块材料评审与增量接入合同：[FBA 头程、WMS 与财务总账纠正版方案](fba-wms-ledger-corrected-plan-2026-11-11.md)；包含 API 前提纠错、库存/会计边界、可靠事件及阶段验收，不代表已实施或完成真实业务验收。
- P0-C 首批本地计划及库存交接：[实施合同与验证入口](p0c-fba-local-plan.md)；支持本地草稿、WMS 独立审批及原子预占关联，未接入 Amazon 写入或头程页面。

## WMS Schema 复用评审

- [32 张候选源表逐项映射与 Schema 增量评审](wms-table-reuse-review.md)：对照现有 11 模型，区分合并复用、业务扩展、跨模块合同和派生查询；目标候选不代表已实现。
- [盘点 Schema 基础切片](wms-stocktake-schema-foundation.md)：本批新增 3 模型及约束，尚未启用盘点业务入口或过账。
- [机器映射及本轮源 DDL 摘要](evidence/wms-table-reuse-review.json)。

## 模块融合判断

A–E 按具体能力切片使用，不能把一个大模块整体标为已完成。下表是当前 ERP 工作树对照，不代表生产部署状态。

| 域 | 当前 ERP 状态 | 已核实的 Wimoor 源码范围 | 当前融合结论与下一批任务 |
| --- | --- | --- | --- |
| 商品/商品标识 | B：ProductRecord 已是商品事实源；供应商/采购关联及仓库批次不是商品主档能力 | ERP `material`、组合/物料条目、商品引用；字段详见 Entity 和 SQL 清单 | 保持 ProductRecord 唯一主档；SKU/ASIN/FNSKU、组合品和包装/品牌关系按源字段语义复核，禁止把外部快照覆盖主档；P0 先补必要关系字段映射 |
| 采购 | 部分实现：当前代码已有采购单、独立付款/退款复核及总账来源交接；明细费用分摊、供应商完整对账和源流程对等尚待核实；本次未复验运行 | `wimoor-erp/erp-boot/src/main/java/com/wimoor/erp/purchase/`；本次核对付款 Controller→Service→Entity/DDL/Mapper，见[采购付款研究](procurement-payment-research-2026-11-12.md) | 复用目标已有链；先完成采购单/明细粒度、费用项目、账户/币种及退回/重付语义映射，再形成具体实施变更，不重复开发已有付款/退款模型 |
| WMS/库存 | B：首个公司仓核心闭环已实现并本地隔离验证；不是全部 WMS 功能完成 | `inventory/`、`warehouse/`、`stock/`。8 条库存/单据规则 VERIFIED，具体调用链见 [P0-B 单](p0b-wms-change-list.md) | P0-B 收货、分批质检/上架、预留、拣货、发货/释放、转移、流水、审批/权限与本地查询已通过合成隔离验证；P0-D 再做盘点、冻结、报损、退货、库龄、库存预警等差距审查。负库存开关排除(E) |
| FBA 头程/物流 | B：有 Logistics 文件处理、头程运费及月仓储费本地估算和 Amazon Inbound 只读采集；无证据表明完整 V2 写入、物流轨迹和费用分摊闭环已完成 | `wimoor-amazon/amazon-boot/.../inbound/`、`inboundV2/`；ERP `ship/`、`order/` 及箱/货件相关实体；清单中的 15 张 inbound Entity 表只是一个包范围 | 本地运费估算采用 Wimoor 重量/体积重分支，仓储估算采用其立方英尺月费公式；费率均由用户输入，不读实际站点费率；P0-C 逐 Operation 对照现代 Fulfillment Inbound 官方契约，完成本地计划/装箱/审批/异步恢复设计；P1 再处理费率来源、汇率、货代、报关、轨迹和费用分摊。旧版已移除写 Operation 不照搬 |
| Amazon 数据 | B：Orders、库存、Finance、Reports、Inbound 等已有多个同步适配器/查询流程，能力与数据域覆盖不等于全量完整 | `wimoor-amazon/amazon-boot/src/main/java/com/wimoor/amazon/` 下授权、商品、订单、库存、报告、财务和 inbound；方法候选在 API/Service 工作簿 | 保持当前统一同步、授权、归档、恢复与查询架构；按 Operation/字段/角色/分页/限流逐条验证，P3 继续覆盖缺口。官方 Schema 依据不足的行维持 UNCERTAIN |
| Amazon 广告 | B：Ads 账户、报告同步/分析已有；完整实体写入、历史修改审计、站点版本适配需逐项证明 | `wimoor-amazon-adv/amazon-adv-boot/` 的 SP/SB/SD 实体、报告、规则、计划任务和 API 调用 | 保留当前 Ads Adapter 和 PPC Bulk 草稿边界；Ads 现代化矩阵目前是初始能力候选，按 LIST/GET/写 Operation 与 Reporting/Export 分拆验证，不能按旧 SDK 直接实现 |
| 财务/成本/利润 | B：Amazon Finance 数据解析/查询存在；采购应付、公司总账、期间关账、可审计 SKU 成本不是同一能力 | `wimoor-modules/wimoor-finance/` 科目、凭证和结账候选；Amazon `finances/`、`profit/` 和 ERP 采购付款。公式证据见[公式目录](formula-evidence.md) | P1 先连接采购/物流来源与 SKU 成本/AP/AR；P2 再建会计期间、过账、冲销、对账和总账闭环。Amazon 估算费用不得自动当作已入账实际费用 |
| 自动化任务 | B：当前 ERP 已有注册 Worker、队列、调度、重试/检查点；逐业务覆盖程度待域审查 | Quartz 静态调度代码 + 数据库动态注册/HTTP Job 链；Wimoor 任务库内容未被读为已运行任务清单 | 复用现有 worker manager。逐数据域补比对运行周期、分页、租约、重试、检查点和发布；Quartz/Nacos 运行架构不迁入 |
| AI/MCP/智能分析 | D：旧系统页面/服务经验可参考，但调用权限、查询口径与当前 Lili/统一服务架构不同 | 模块中的报告、补货和利润服务可作业务证据；当前扫描没有证明 Wimoor Agent 能力可原样移植 | 复用 ERP 统一查询服务、现有 MCP 和 Agent 工具门禁；P4 仅输出建议/草稿并人工确认，任何执行都经过服务端授权与审计 |
| 1688、旧 UI/微服务运维细节 | E：依赖当前公司采购来源、组织方式或技术架构评估 | `purchase/alibaba/`、旧 Vue/uni-app 页面、Nacos/Seata/Quartz 配置 | 有实际业务需求再单项评审；不复制整套采购平台、前端、微服务基础设施或供应商 API |

## 当前融合次序

1. **P0 商品、采购、WMS/库存**：WMS 的本地代码闭环和隔离功能/容量验证已完成；接下来以采购单到收货、退货及 WMS 交接为主，P0-D 库存补全独立立项。实际数据库迁移、真人仓库验收和生产部署未执行。
2. **P0-C FBA Inbound V2**：沿指定本地 SP-API 指南和官方 Schema 逐操作核实；外部写操作保持关闭，先做本地状态机、审批与未知结果恢复。
3. **P1 头程、采购财务与成本**：提取采购付款/退款、头程计费、分摊及多币种 SKU 成本公式，落实原币、汇率日期、精度、舍入、余数及来源凭证。
4. **P2 财务总账、应收应付、利润**：先确认科目、会计期间、借贷方向、过账/冲销和 Amazon 真实交易口径，再实现可追溯闭环。
5. **P3 Amazon/Ads/自动同步完善**：按已有数据中心和 MCP 主线持续推进；对照矩阵的 UNCERTAIN 项需官方契约/字段级证据，不因 P0–P2 顺序阻塞当前主线。
6. **P4 AI/MCP**：接统一查询服务，生成建议或草稿，审批、执行和回读分离。

## 状态解释与边界

- `verification.json` 记录 P0-B 本地合成数据验证，包括临时 PostgreSQL、实际本地 HTTP 路由、两会话浏览器、并发/幂等和容量基线。它不是生产数据、真实仓库、Amazon 或部署验收。
- 当前 P0-B 状态：`CODE_IMPLEMENTED=true`、`TEST_VERIFIED=true`、`ERP_QUERY_VERIFIED=true`；`REAL_DATA_VERIFIED=false`、`MCP_QUERY_VERIFIED=false`、`SKILL_E2E_VERIFIED=false`。
- `erp-existing-capability-matrix.xlsx` 是首轮 11 项偏 WMS 的矩阵，不覆盖全公司所有模块；不得把它误读为全域能力完整审计。
- 当前规则簿中只有 8 条 Wimoor WMS 源码规则人工 VERIFIED；公式目录是首批公式证据，不声称全量公式穷尽。提取异常、动态调用和 API 缺口仍按 UNCERTAIN 留存。
- 无任何业务数据迁入当前 ERP；未连接真实数据库、Redis、Amazon 或生产环境；未提交、推送或部署。

## 主要待办

- 采购与收货：补齐供应商/采购计划/审核、部分收货与退货、付款/退款状态、单据台账的源调用链与状态表，再扩展能力矩阵的字段级行。
- FBA/物流：列出 Inbound V2 每一步源方法、请求/响应字段与本 ERP 状态映射；货代、报关、轨迹、费用分摊逐能力核实，避免只按表名归属。
- 财务：审阅凭证、科目、银行对账、结账服务；提取所有成本/利润算法的分支与费率数据来源，区分估值模型与实际账务。
- Amazon/Ads：把现代化候选关联到官方 Operation schema、ERP Adapter、权限角色和测试；不足项维持 D/UNCERTAIN，不能用生成 SDK 替代官方契约。
- 自动化：针对实际启用任务记录任务 ID/触发周期、handler、输入/输出、幂等/恢复契约；不把动态 Job 代码候选当在线任务状态。

以上任务只在对应域进入实施时扩展，不要求先读完或逐行人工审核全部 14 万行 Service。
