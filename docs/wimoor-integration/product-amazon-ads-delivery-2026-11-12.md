# 商品、Amazon 数据与广告融合：本地交付与剩余边界

日期：2026-11-12。目标环境为当前 ERP 本地代码；用户连续要求全量移植，覆盖本地实现与隔离验证。本文记录已核验切片和未完成项，**不是全量移植完成、真实数据或生产验收报告**。保留 Next.js / TypeScript / Prisma / PostgreSQL、ProductRecord 唯一主档和统一服务端查询。未运行既有数据库迁移、历史数据导入、真实 Amazon 调用、生产任务、提交、推送或部署。

## 来源和行为区分

| 能力 | Wimoor 真实实现 | ERP 已有边界 | 本次融合/自研扩展 |
| --- | --- | --- | --- |
| 商品主档与标识 | ERP Material 的 sku/name/brandid/categoryid、Amazon ProductInfo 的 sku/asin/fnsku/授权/站点 | ProductRecord、revision、附件绑定、审计、Outbox 与可重建投影 | 在原编辑器维护 management；不建立第二主档。标识选择实时授权账号和本地站点绑定，保存不发布 Listing |
| 包装、组合品 | Material 的尺寸、外箱箱数；Assembly 的 mainmid/submid/subnumber/remark，保存校验正数 | 商品/包装尺寸和重量字段继续复用 | 外箱 cm/g、精密小数字符串、未知 null；同工作区子商品正整数用量；事务锁和图遍历阻止并发循环。商品组成不改变库存 |
| 品牌与分类 | MaterialBrand/MaterialCategory 按 shopid 查询；源分类平级 | ProductMaster 是派生层 | 共用有类型的 ProductCatalogEntry 字典，kind=BRAND/CATEGORY；revision、审计、停用保留；已引用的停用字典可继续保存原商品，新引用被拒绝 |
| 多供货关系 | MaterialSupplier 的 supplierid/productCode/purchaseUrl/deliverycycle/MOQ/isdefault | 组织 Supplier 与 ProductSupplier 投影 | 主档保存多个已有供应商且恰有一个主供应商；投影更新、移除及重建；最后关系删除清理原主供应商展示值 |
| 广告操作日志 | `AmzAdvOperateLogServiceImpl.java:45-60` 保存 profile/operator/opttime/beforeobject/afterobject，各实体分支持续至约 290 行 | SP 九类结构当前快照、同步任务/查询、个人账户授权 | 新增 ERP 草稿与独立审核；新增可选采集观察历史。观察历史不是源操作日志的等价复制，不知道外部操作者，也不覆盖采集间隙 |
| 广告预算/竞价/展示位置 | 各 SP Service 调用原广告写入与日志，旧协议需现代化 | 现有代码未实现正式写入 | 本地业务 patch 只用于草稿，按实体限制字段；金额精度、24h 有效期、幂等键、CAS、独立审核、基线指纹及实时撤权检查为目标扩展。审核通过仍未执行 |

商品源码锚点和字段明细沿用 [商品变更清单](product-management-port-change-list.md)。源码根为 `/Users/chenjieliang/Documents/wimoor`，快照证据见 [基线](evidence/research-baseline-2026-11-12.json)。广告日志相对路径为 `wimoor-amazon-adv/amazon-adv-boot/src/main/java/com/wimoor/amazon/adv/common/service/impl/AmzAdvOperateLogServiceImpl.java`。源许可保留于 `public/licenses/wimoor-MIT.txt`。实现为目标域重新表达的业务行为，不运行 Java、MySQL、Quartz 或源微服务。

## 可操作入口

- 商品原详情/编辑器的“商品管理”：品牌、分类、外箱、组成、多供货关系和授权店铺/站点标识；保存走原聚合事务。字典通过 `/api/products/catalogs` 复用 `catalog-service.ts`。原调用者省略 management 时保留已有管理事实。
- 广告原 SP 活动、广告组及关键词/投放/否定列表的来源区域：“变更草稿与历史”。展开才请求，不增加全局轮询。通过 `/api/integrations/amazon/ads/changes` 调用统一 `change-service.ts`，读取权限不隐含管理权限。
- 草稿状态：DRAFT→SUBMITTED→APPROVED/REJECTED；创建人可从 DRAFT/SUBMITTED/APPROVED 取消为 CANCELLED；提交/取消限创建人，审核须其他人。没有 EXECUTED 状态或真实执行按钮。状态为目标工作流，不冒充 Amazon 状态。
- 可草拟字段：SP campaign 的状态/名称/每日预算/展示位置；SP ad-group 的状态/名称/默认竞价；keyword/target 的状态/竞价；product-ad 和四种否定实体的状态。SB/SD 和未知字段拒绝；patch 不等于 HTTP 请求体。
- 观察历史在同步写入的同一事务内存储、脱敏、去重，查询仅释放成功来源任务，数据库拒绝历史 UPDATE/DELETE；不推断遗漏实体已删除。

## 迁移、启用与回退

新增 `20261212020000_ads_changes_and_history` 迁移定义草稿与观察表、作用域外键、唯一键、状态/版本/独立审核约束、不可变触发器。既有商品字典迁移 `20261212010000_product_management_catalog` 继续适用。新迁移仅在本次明确创建的空临时库执行过，未应用到现有库。

观察写入默认关闭：只有完成迁移并独立验收后，才在唯一配置源根 `.env` 设置 `AMAZON_ADS_ENTITY_HISTORY_ENABLED=1`；`.env.example` 只说明开关，本次没有更改真实配置。未启用时保持原同步可运行，新增入口缺表会明确返回 503，不伪装为空成功。开关不授权启动任务、不启用 Ads 写入，也不会回填之前历史。

回退先关闭新增 UI/入口和观察开关，保留已保存事实、字典、草稿和审计。不能降级到会裁剪 management 的全量保存路径。不得删除表、反向迁移或清理历史来回退业务事实。本次没有更新 Root/Layout/Provider/导航，无新增 Worker 或队列。

## 隔离验证

可重跑命令：

```text
node node_modules/tsx/dist/cli.mjs --test tests/product-projection.test.ts tests/product-consistency.test.ts tests/product-edit-draft.test.ts tests/amazon-ads-capabilities.test.ts tests/amazon-ads-sync.test.ts tests/amazon-ads-business-changes.test.ts
node scripts/test-wimoor-management-offline.mjs
node node_modules/@playwright/test/cli.js test --config tests/browser/management-port.config.ts
node node_modules/@playwright/test/cli.js test --config tests/browser/playwright.config.ts
node scripts/runtime/typecheck.mjs
```

- 42 项相关单测通过，覆盖精密值/未知值/重复引用、组合循环、草稿状态/独立审核、已有商品和 SP 同步规则。
- 临时 PostgreSQL runner 不继承真实环境变量、不读根 `.env`；仅使用预装 postgres:16-alpine，新建有标签/随机名的容器，创建当前基线后执行两份确切迁移 SQL；网络守卫拒绝外部 HTTP/TLS/DNS，结束只清理自己创建的资源。
- 临时库 7 项集成全部通过，覆盖实际聚合保存回读、投影品牌/关系新增与删除、版本恢复、审计/Outbox、过期/基线变化、幂等、并发审核、撤权/停用/跨工作区、历史不可修改、来源任务失败隐藏、并发 A→B/B→A 拒绝循环；SQL 等待期间撤权必须扣留整个变更结果。
- 独立组件浏览器测试 1 项通过；原编辑器原有 17 项通过，新增 1 项从原入口编辑箱规/组成/刊登标识，保存回读通过。浏览器使用 route fixture；数据库服务行为由临时库单独验证，不称生产 UI 验收。
- 原 `test-amazon-ads-offline.mjs` 的结构集成文件 23 项通过。修正测试里旧的“站点限制读取/管理员免账号分配”假设，保留 Profile 过滤、其他账号不可读、实时撤权和绑定变化断言。**同一完整命令的 MCP 文件仍 12 项失败/2 项通过**：旧工具授权假设、任意 business 字段过滤断言、错误文案/失败后清理等需单独按当前统一账户读取契约更新，不能宣称全套绿灯。
- Prisma validate 和相关 ESLint 通过；最终类型检查通过。未执行完整 check/构建、性能基准或真实权限联调；准备合码/发布时需完整 check，真实联调按单独授权进行。

## 不能静默算作完成的全量余项

| 范围 | 当前能证明的代码边界 | 剩余可执行任务和完成条件 |
| --- | --- | --- |
| 授权/店铺/站点 | `amazon-sync/oauth.ts`、`stores.ts`、`data-access.ts` 及现有同步 | 继续逐 Operation 对照 Wimoor 与指定本地 SP-API 指南；OAuth/账号数据存在不能充当真实账号验收 |
| 商品/订单/库存/退货 | `catalog-report.ts`、`orders.ts/orders-query.ts`、`inventory-replica.ts`、`returns.ts/returns-query.ts` | 对照字段粒度、分页/回填、状态/来源完整性及异常恢复；复用当前查询，不因名称一致另建表。此次未全域重验 |
| 财务/结算/报告 | `finance*.ts`、`settlements.ts`、`domain-reports-query.ts`；正式总账来源在 `finance/external-source-service.ts` | 完成结算 SKU 分摊输入分类/币种/费用语义与目标预览、差异/守恒、人工审核交接；不得把估算直接过账或把缺失归零 |
| Listing/FBA | 既有 Listing 属性恢复及 `fba-local/remote-action-service.ts` | 逐步骤核对最新远程请求/响应、幂等未知结果、装箱/货件/接收回读；本地计划不当作远程货件已创建 |
| SP 实体 | 九类 reader、worker、查询和新增草稿/观察历史 | 补正式更新 Operation 的完整请求/207逐项响应/错误/归档约束、限额和前后回读；再接既有任务/审计。没有这些合同不实现“假成功”执行器 |
| 搜索词/展示位置/广告表现报告 | 通用已发布事实查询；campaign acquisition 为 isolated fixture | `report-dispatch.ts` 当前明确 `liveEnabled:false`，阻塞项为 downloaded JSON 编码、账号绑定、下载域名和持久化 v1 runtime。补验证与正式发布，再按报表域实现，不只加页面 |
| SB/SD | capability 清单除 profiles 外仍 NOT_IMPLEMENTED | 分别读取对应 Operation schema，按广告产品构建适配/分页/身份/查询/草稿/报告；不能复用 SP 媒体类型或猜统一版本 |
| 自动广告规则 | 源 `AdvSchedulePlanServiceImpl.java:72-82` 的 `saveMyTimeTask` 只初始化 temp=0 并返回 | 源其他实际 handler/调用需继续核实；目标按现有注册 Worker、时区/夏令时、幂等、租约/重试、审批和预算保护实现。此空实现不能证明源完整调度可用 |
| MCP | 当前统一查询入口继续复用 | 收敛旧测试到当前账号授权和正式字段契约，保持撤权/隔离与秘密字段脱敏断言；新增草稿尚未注册 MCP 写工具 |
| 全业务/公式/历史数据 | 9,082 源文件摘要只证明基线未变化 | 全部业务语义和公式尚未穷尽；保持 [研究执行约束](research-execution-contract-2026-11-12.md) 的逐能力证据。历史数据迁移另需源导出、映射、冲突/精度预演、批准和回读 |

本地 Ads 指南 `/Users/chenjieliang/Desktop/亚马逊官方文档Ads-API官方文档配置.md:960-961` 列出了创建/更新路径，但相应完整请求/逐项响应 schema 未在本次定位到；`9060-9069` 是通用映射及示例说明，不能据此虚构 payload。真实写入缺失的是合同/实现/验证，不是再让用户笼统确认“开始”。

结算研究新增锚点：`wimoor-amazon/amazon-boot/src/main/java/com/wimoor/amazon/finances/service/impl/AmzSettlementSKUShareServiceImpl.java:316-359` 本金总额大于 0.0001 时按本金，否则按销量，30 位 HALF_UP 比例、费用四舍五入到 2 位；`:109-310` 的 setValue 分支使用 floatValue 比较并截取剩余；`:495-585` 选择本金最大的项承担余差，源查询未定义同额排序。目标不能把该算法直接用于不同最小币种单位或原始本地化金额；先补明确策略和守恒预览，不自动覆写结算事实。
