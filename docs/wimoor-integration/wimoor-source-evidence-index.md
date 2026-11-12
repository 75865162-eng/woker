# Wimoor P0-A 源码证据索引

当前 WMS 能力映射、可执行状态转换、异常恢复及事件契约见 [WMS 能力与契约](wms-capability-contract.md)。历史设计/验证状态保留为各自时点记录；当前已实现及待接入边界以该补充和对应代码为准。

日期：2026-11-11。源码扫描与首个 WMS 切片复核已开展；不是生产验收，也不宣称全量业务规则已确认。

本轮仅新增 `scripts/wimoor/`、本目录及独立输出目录；原工作区的 Schema、Amazon/Ads/Lili、迁移、测试和配置改动均未覆盖。未读取根 `.env`、未连接数据库/Redis、未运行应用/Worker、未请求 Amazon，未提交/推送/部署。

## 输入身份和统计结果

Wimoor 路径：`/Users/chenjieliang/Documents/wimoor/`。HEAD：`8f894b1eccb8df5d16af19a75c6a517795bf02a5`，不是 clean checkout；源工作树差异清单在 [summary.json](evidence/summary.json) 的 `source_changes`，逐文件 SHA-256、字节数及类型在 [files.json](evidence/files.json)。证据引用的是这些文件内容，不能只用 HEAD 复现本轮结果。

提取器：`scripts/wimoor/extract-evidence.py`，版本 `p0a-1`；机器解析范围为 `rg --files --hidden` 的非 ignored 文件，明确排除 `.git`、node_modules、target、dist。输入共 **9,082** 文件，全部计算摘要；其中 Java **4,382**、SQL **813**、Mapper 路径 XML **441**、页面候选 **814**、其他 **2,632**。页面仅建立文件清单，不据此认定路由、交互或业务动作已核实。ignored/构建输出不在扫描分母中；本轮没有将“没有解析出方法”文件排除出分母。

补充以 `--no-ignore` 对照同一排除目录：另有 39 个 ignored 文件，Java/SQL/XML/页面扩展名候选为 0，见 [ignored-scan.json](evidence/ignored-scan.json)。只核对文件名，不读取 ignored 配置内容；因此本轮没有发现由 ignore 规则漏掉的上述源码候选。

| 口径 | 实测 | 与任务书的关系 |
| --- | ---: | --- |
| CREATE TABLE 定义出现次数 | 748 | 包含数据脚本中的 7 份重复 DDL，不是 748 张不同表。 |
| 按数据库目录/USE/显式限定名 + 表名去重 | **741** | 与 743 差 2；未发现源码依据可把差额补成两张表，任务书原始统计口径仍待提供。 |
| 重复身份 | 7 | 定义签名均一致；来源见 duplicates.json，未静默丢弃。 |
| 发现的冲突表定义 | 0 | 仅指本提取器支持的 CREATE TABLE 列体口径，不是 Entity/Mapper 一致性已通过。 |
| 字段定义/约束索引记录 | 9,197 / 1,656 | 保留来源、默认值和可空性；KEY 不因命名 FK 就被认定为外键。 |
| Entity/domain 候选、字段候选 | 536 / 5,084 | 包含没有 @TableName 的 domain；需回到 XML resultMap/继承字段复核，不能假设驼峰转表名。 |
| Service 候选（非 SDK、非接口） | 577 文件；146,961 总行；124,469 有效行；5,630 方法签名 | 候选条件：路径含 /service/ 或文件名含 Service；有效行=去注释后非空行，含 import/括号。与 142,000 差 4,961；口径不同不能当增长量。 |
| Service 接口候选 | 435 文件；12,674 总行；6,391 有效行；2,713 签名 | 与实现分列，不合并成“14.2 万 Service 实现”。 |
| SDK 中 Service 名称候选 | 43 文件；8,095 总行；4,762 有效行；675 签名 | 可能是含 Service 字样的生成模型；不视为业务 Service。其余 SDK 仍在 Java 文件/API 目录中。 |
| 文件名严格以 ServiceImpl.java 结尾 | 131,863 总行 | 另一个可复现口径，同样不能复原任务书的 142,000。 |
| Service 候选完全相同内容复制文件 | 0 组 | 逐文件 SHA-256 比较；语义复制/生成模板相似度未分析。测试 Service 候选为 0，不代表仓库无测试。 |
| 方法/调用候选/Mapper 语句 | 9,018 / 102,016 / 2,130 | 调用是 receiver.method token；未完成 DI/重载/反射/动态 SQL 分派解析，不是已解析的全量业务调用图。 |
| API 方法候选 / 调度候选 | 4,589 / 10 | 包含 SDK overload/wrapper；调度候选包括数据库动态注册与误报可能，非实际在线任务数。 |

数据库身份分布：db_admin 81、db_erp 190、db_amazon 244、db_amazon_adv 157、db_datamove 4、db_finance 28、db_quartz 11、db_quote 22、seata 4，共 741。数据库身份来自源码目录/DDL，而非连接真实数据库验证。

临时表定义 0；当前扫描未识别 CREATE VIEW（不是在线库视图证明）。备份/复制命名候选 `db_erp.t_erp_purchase_form_entry_copy` 单列待定性，仍保留在 741 身份中，不因名字含 copy 自动排除。结构目录共 748 个 SQL，其中 7 个无建表定义，为例程/操作脚本；另外数据目录 7 份重复 DDL 使全树建表出现次数也恰为 748，两个 748 是不同口径。

模块数量不能互相相加：

| 可复现选择范围 | 候选表数 | 判定 |
| --- | ---: | --- |
| ERP inventory、warehouse、stock 包的 TableName 注解 | 32 | 与 WMS 30 不同；包含海外调拨、库位、历史和报表。完整成员清单见 module_membership.json。 |
| Amazon inbound 包 TableName 注解 | 15 | 只是入库包切片，不是 FBA 全域；与 38 的范围尚未对应，不能声称“只剩 15”。 |
| db_finance 的 fin_* 26 张 + ERP finance 注解 5 张 | 31 | 不含 Amazon 结算/费用等财务相关证据，不能宣称等于全公司财务域或用它推翻 46。 |

上述 WMS/FBA 注解集合共享 `t_erp_warehouse_shelf_inventory_opt_record`；还有商品、仓库等跨域服务依赖，独占表/共享表归属尚未逐一批准。以 [module_counts.json](evidence/module_counts.json)、[dependencies.json](evidence/dependencies.json) 和 [table_references.json](evidence/table_references.json) 分开保留候选关系，不简单加表数。

## 漏扫、解析异常与人工复核

[exceptions.json](evidence/exceptions.json) **182 条**：116 个 Service 候选未提取方法（可能为空/仅继承通用 Service，也可能是未支持语法），65 个 SQL 无建表定义（含数据/例程脚本，不执行、不导出 INSERT），1 个 Java 块无法配对，位于 `wimoor-common/common-core-ext/src/main/java/com/wimoor/common/core/utils/StringUtils.java:605`。不是关键 WMS 事务入口；保留在分母和异常目录。

机器扫描有意不宣称语义覆盖率 100%。每个源文件已登记摘要，但 Java package-private/复杂泛型/注解、匿名类、文本块、动态调用、MyBatis include/foreach、注解继承、SQL 过程内 DDL 和其他 SQL 方言均可能超出词法提取能力。`apis.json` 的注解是邻近源码候选，不是完整 Controller URL 的权威拼接。`calls.json` 全部保留 UNCERTAIN，接口代理与反射不隐式“解析成功”。缺少官方 Schema 的 Operation 同样保留 UNCERTAIN。

规则人工确认单独计数：当前 **8 条 VERIFIED 源码规则**，4 条目标设计规则在目录中标 INFERRED，并在目标说明中明确 PROPOSED；未建立其他域全量业务规则分母，所以不报告虚构的“人工确认百分比”。VERIFIED 只证明指定源码行为，不证明源系统业务正确或真实运行通过。

首个切片的 Controller → 单据 Service → InventoryFormAgent → InventoryService → Mapper/流水链与具体行号见 [P0-B 修改确认单](p0b-wms-change-list.md)。尤其已确认：

- 库存 Mapper `selectNowInv` 使用 `FOR UPDATE`，不是无锁查询；新增实现需同时处理不存在余额行的并发与数据库幂等。
- Wimoor 可配置允许 fulfillable 负数；目标排除，不移植该开关。
- 普通整单事务入口在 Controller；目标改由应用服务保护所有入口。
- 库位单独数量与记录不能变成 ERP 的第二套库存事实。
- 待入库不是质检完成；质检/批次/本地条码是本次提出的明确契约，不能假装源码已提供全部公司策略。

动态调度实际链：`SystemSchedulerInit.run` → `SystemSchedulerServiceImpl.refreshTask` → QuartzTaskMapper → cron/path JobDataMap → `QuartzTaskFactory.executeInternal` 的 HTTP GET。源码可确认数据库配置驱动，未枚举业务 INSERT 中的任务 URL/参数，不把动态注册库当已扫描的静态注解任务。新 ERP 保留既有 worker manager；首个 WMS 同步事务不需要新 Worker。

## 当前 ERP 与旧 API 结论

[erp-existing-capability-matrix.xlsx](../../outputs/wimoor-p0a-20261111/erp-existing-capability-matrix.xlsx) 是 P0-A 提取时生成的首版 11 项 WMS 偏重矩阵，不是当前 ERP 的全域/最新能力快照。该矩阵当时记录的 Schema 差距已被后续本地 P0-B 实现改变；当前综合状态、域级任务与实现边界以[研究入口](README.md)和 [verification.json](verification.json) 为准。AmazonInventorySnapshot/SellfoxFbaInventorySnapshot、补货建议和 Logistics 文件操作仍不等于公司仓事实。ProductRecord 仍是商品主档唯一事实源。

当前本地工作树已包含公司仓、区域/库位、批次、收货/质检/上架、库存余额/预留/流水/命令、审批与采购基础模型及业务服务。P0-B 功能在临时 PostgreSQL、真实本地 Route Handlers、双会话浏览器、并发/幂等和容量基线中已验证，详见 `verification.json`；这不代表已有库迁移、真人仓库、Amazon、MCP 或生产验收。ERP 源文件指纹 `erp_evidence.json` 是 P0-A 时点快照，不能用于描述后来加入文件的状态。

当前 `sp-api-client.ts` 已见 Orders 2026-01-01、Finances 2024-06-19 和 Inbound 2024-03-20 **只读**方法；本轮未发现必须先修复才能实施本地 WMS 的已移除在线 Operation。Wimoor `FulfillmentInboundServiceImpl.createInboundShipmentPlan:289`、`createInboundShipment:481` 则仍调用旧建计划/货件；本地指南记载这些 v0 核心写操作已于 2025-01-21 移除，**禁止照搬**，列入 P0-C 门禁。不能据此推断所有 Inbound v0 读取也被移除。

SP-API 版本资料只读指定本地指南 §16/18，其 SHA-256 在 sp_modernization.json。未在线查证，尚无本轮所需各 Operation 的完整官方 OpenAPI 来源/获取日期/字段/角色/限流证据；源码 SDK 不代替官方证据。SP-API 矩阵是初版域/Operation 候选（31 行），Ads 是初版 5 类能力；**都不是字段级现代化验收完成**。具体 SDK 方法全集在 api-inventory，待所属实施域逐项确认。Schema 缺口阻止 P0-C 写接口接入，不阻止本地 WMS 规则研究。

MCP 当前 `mcp.ts:451/534/566/591` 分别为目录、描述/查询、同步申请和状态分支；querySkillTable/readEntities/readReports 与现有授权查询层衔接，gateway 不提供公司仓写权限。WMS 使用独立业务 query-service 后再接既有入口，本批不复制 MCP 目录、不增加任意 SQL 写工具，也不改现有同步生命周期。

## 交付与复现

13 个工作簿是机器目录/首版映射，不是空壳，也不是 13 个已验收业务模块。正式输出在 `outputs/wimoor-p0a-20261111/`，本目录使用同名相对符号链接定位，避免复制大文件。JSON 原始数据为可审计的完整提取结果，工作簿为审阅视图。

| 工作簿 | 内容 |
| --- | --- |
| [表目录](wimoor-table-inventory.xlsx) | 表身份、目标决定、关联候选、重复和冲突；长关联关系单独行保存，避免 Excel 单元格截断。 |
| [字段目录](wimoor-column-inventory.xlsx) | 全部 SQL 列及 Entity/domain 字段候选，保留冲突来源。 |
| [索引约束](wimoor-index-constraint-inventory.xlsx) | DDL 原约束/索引及列序。 |
| [Service 方法](wimoor-service-method-inventory.xlsx) | 文件/方法/事务注解候选及复制文件检查。 |
| [规则目录](wimoor-business-rules.xlsx) | 8 条人工源规则 + 4 条明确目标规则。 |
| [调用图](wimoor-service-call-graph.xlsx) | receiver.method 候选边与 Mapper SQL，未解析分派显式列出。 |
| [调度目录](wimoor-scheduler-inventory.xlsx) | 静态/动态注册候选、未知恢复语义。 |
| [API 目录](wimoor-api-inventory.xlsx) | 源码/SDK 方法与 ERP 31 个客户端方法。 |
| [模块依赖](wimoor-module-dependency.xlsx) | 包域候选、import、Entity、页面索引。 |
| [ERP 能力矩阵](erp-existing-capability-matrix.xlsx) | 11 能力项与 ERP 文件摘要。 |
| [SP-API 现代化](sp-api-modernization-matrix.xlsx) | 本地指南版本、目标 Operation 候选、官方契约缺口。 |
| [Ads 现代化](ads-api-modernization-matrix.xlsx) | SP/SB/SD/Reporting/Export 首版缺口。 |
| [Prisma/WMS 字段映射](prisma-model-mapping.xlsx) | 首批 10 源表的 137 字段，目标不确定项保留；不是全部目标字段已完成映射。新增质检、幂等、审批等无源字段见修改确认单。 |

无凭据复现（源码树保持本轮状态）：

```bash
python3 scripts/wimoor/extract-evidence.py --source /Users/chenjieliang/Documents/wimoor --output docs/wimoor-integration/evidence
python3 scripts/wimoor/prepare-review.py --evidence docs/wimoor-integration/evidence --erp .
python3 -m unittest discover -s scripts/wimoor -p 'test_*.py'
```

工作簿使用已安装的 `@oai/artifact-tool`，不安装或升级仓库依赖。在独立输出目录链接 `load_workspace_dependencies` 返回的 node_modules、复制 `scripts/wimoor/build-workbooks.mjs` 后，使用同一 bundled Node 运行 `--input <evidence绝对路径> --output <输出绝对路径>`。每个工作簿独立进程，含逐表预览与行列计数，避免一进程累积全部工作簿内存；不 import ERP 或加载 .env。

根许可 MIT，版权 `Copyright (c) 2022 深圳市万墨信息科技有限公司`，完整文本保留在 [WIMOOR-LICENSE.txt](WIMOOR-LICENSE.txt)。本轮只提取结构/标识/规则证据，未复制业务数据 INSERT、凭据或初始化用户；第三方依赖和其他代码许可仍须对应实施域复核，MIT 根许可不能替代该检查。

## 当前门禁与后续动作

机器全量清单及解析异常已登记；首个 WMS 闭环已从 P0-A 计划进入 P0-B 本地实现，并完成合成隔离功能和容量验证。当前状态：`CODE_IMPLEMENTED=true`、`TEST_VERIFIED=true`、`ERP_QUERY_VERIFIED=true`；`REAL_DATA_VERIFIED=false`、`MCP_QUERY_VERIFIED=false`、`SKILL_E2E_VERIFIED=false`。实际数据库迁移、真人仓库验收和生产部署未执行。详细验证环境、步骤及未运行项见 [verification.json](verification.json)。

当前规则工作簿中的 8 条 VERIFIED 是 WMS 源码规则，不代表其他域规则完整；首批利润/采购公式证据另见 [formula-evidence.md](formula-evidence.md)。能力矩阵、SP-API/Ads 现代化矩阵是首版审阅输入；其他模块的源码流程、公式、字段差异和任务按[研究入口](README.md)所列实施阶段继续核实，不能用机器方法/表候选代替业务规则复核。
