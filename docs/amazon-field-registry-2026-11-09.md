# Amazon 字段级建设：2026-11-09 实施记录

本记录对应用户字段级任务书。本轮是 P0/P1 与结算 P2 的增量实现，不能作为全量数据中心完成声明。

## 已实现链路

`AmazonSyncRawPage` 加密原件归档事务 → JSON/TSV 字段扫描 → `AmazonDataSourceRegistry` / `AmazonFieldRegistry` / `AmazonFieldObservation` → 已实现解析规则的 `AmazonFieldMappingVersion` → 管理员字段目录 API / MCP。

- L0 稳定 ID 根据 provider、精确 sourceCode、apiVersion、原始路径生成 SHA-256。原始路径加密保存，TSV 保留原始列名大小写与空格，JSON 数组使用 `/*` 路径。原始数值/对象仍在原件中，字段目录不保存样本。
- 观察记录外键包含 organization/workspace/task/page，按原件、字段和 scanner version 幂等。记录实际类型、显式 null、非 null、TSV 空字符串及扫描完整性。缺失字段不伪造一次 null 观察。JSON 目前仍复用有界形状扫描，动态路径或数量超限标不完整，原件不会被裁剪。
- 已有原件归档调用链登记观察，包括 Orders/API 响应、库存/刊登、销售日报、退货、结算/赔付/库龄/库存事件及现有 observation adapter；不表示这些执行器均完成真实联调。失败响应也可能登记字段，不据此宣称业务字段已获取。
- 仅已核对当前解析器落点的部分订单与报告字段写映射版本。状态 `IMPLEMENTED_NOT_ACCEPTED`，L1 标准化名保留在规则内，与 L0 原始路径区分。未知字段保持 `UNMAPPED`；不因有目录就标 `VERIFIED`、`PERSISTED` 或 `QUERYABLE`。
- 结构化持久化验收数、查询验收数、官方缺失数目前返回 null；字段目录报告本地观察数和映射数。原始持久化数仅表示字段存在于加密原件，不等于业务列已入库。
- 质量问题继续复用 append-only `amazon.sync.quality.checked` 事件，不重复建立另一套 `FieldQualityIssue` 事实源；当前仍是报告/字段名级问题，尚未全部关联新稳定字段 ID。

查询入口：`GET /api/operations/sync-center?section=field-catalog&sourceId=...&page=1`；MCP `amazon.fields.catalog` 需要明确 sellerAccountId、marketplaceId、sourceId，以及实时管理员角色、已有成员数据授权和显式工具授权。源范围在输出前复核。未知字段名可能含敏感动态键，普通成员不开放该目录。

## 结算币种专项实际结果

目标连接经统一根 `.env` 和本地 Docker 端口归属核查，数据库为既有 `amazon_sync_live_local`，使用 PostgreSQL `READ ONLY` 事务；没有迁移、业务写回或 Amazon API 调用。

运行 `scripts/audit-amazon-settlement-currency.ts --report-only`，限定单个已配置 workspace，目标业务日期 2026-10-10 至 2026-11-08。脱敏结果位于 `outputs/amazon-field-registry-20261109/settlement-currency-audit.json`。

- 当前 workspace 有 4 个结算来源，旧站点报告明细共 65,513 行，币种均缺失。此统计是当前 workspace 的旧站点表全量，不能与用户此前某一筛选的 12,066 行直接比较。
- 与目标日期相交的 8 份站点报告找到可校验原件。原件共 17,053 行，站点投影共 16,757 行；296 行未出现在这些站点投影，不据此认定丢失或去重错误：其中可能有报告头、跨站点或隔离行，仍需卖家级归属核对。
- 这 16,757 条现有明细可从原件的同 settlement-id 单一报告头币种解析，目标日期范围内为 13,266 条。所有已存明细的 rowNumber/rowHash 校验通过，amountOriginal 无变化。上述数量是只读重解析结果，**尚未写回**。
- 实际根因是币种存在于报告头，明细行该列为空。解析器新增 `SETTLEMENT_HEADER` 来源及源行号，限定同 settlement-id、唯一报告头、文件内无币种冲突。缺失 ID、重复头或冲突继续 NULL。已有行级币种优先，不从站点默认币种反推。
- `amount` 与 `total-amount` 已分开：结算交易只读 `amount`，报告头总金额不回填为一条交易金额。原始字段、行号和 hash 保留，不按相同金额/描述合并行。

官方页面 `https://developer-docs.amazon/sp-api/docs/report-type-values-settlement` 已于本轮实际获取。旧 `GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE` 与 XML 类型标为弃用，当前 `GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2` 是替代报告。该页面列出 24 个属性，登记为 reviewed contract subset，不能等同全量机器 Schema。下载页摘要和文档校验记录见 `outputs/amazon-field-registry-20261109/official-settlement-reference.json`。

## 受控修复入口

`recover-report` 扩展 `currencyOnly=true`、`reportDocumentIds`，通过 `previewSettlementCurrencyRepair` 生成不可变清单及 recoveryDigest，再复用既有请求 → 批准 → 应用流程。

修复前须暂停该来源计划、排空活动任务。每次 1–10 份明确档案，复核来源/授权 revision、原件 hash、已存行号/hash/金额和清单摘要。只补既有站点投影中的空币种及来源；同步补对应卖家级已归属行，不添加/删除事实、不改金额、不改发布头、不重启任务。每次写入核对影响数量，冲突整批回滚，记录修复审计和币种质量检查。尚未对既有环境调用该入口。

## 迁移、影响及回滚

迁移 `20261109020000_amazon_field_registry` 新增四张目录/观察/映射表及 scoped raw 唯一索引；结算两张现有行表增加 nullable `currencySource`、`currencySourceRowNumber`。迁移不回填或删除原有事实。

原件归档代码现在依赖这些新表，发布必须先按现有受控流程应用迁移再切换 web/worker。未应用迁移的旧运行环境不可直接切入本轮新归档代码。可回退应用代码并保留新增表/列；不自动 drop 表、不回退数据、不启动迁移或重启。字段批量写入避免逐字段 SQL，JSON 上限沿用 4096 个路径/20 万节点；新增索引和目录增长仍需上线前容量评估，尚无生产 P95 验收。

## 验证及未完成范围

已通过 schema validate、源码 typecheck、相关 ESLint、36 项定向单测；完整离线回归通过 184 项单测、235 项集成测试和 7 项浏览器测试，最终约束迁移另通过 14 项报告链路集成回归。详细验证摘要见 `outputs/amazon-field-registry-20261109/validation.json`。临时 PostgreSQL/Redis 报告链路验证迁移、原件/字段事务回滚、重复扫描、跨 workspace FK、字段查询、MCP 显式授权及撤权、币种修复审批与陈旧清单拒绝。Amazon 响应均为 fixture，不能作为真实 API 验收。完整生产构建留给 CI。

未完成：全官方源/字段注册与完整定义、全量已实现字段映射、每字段结构化/查询验收证据、历史 mapping version 重放、所有历史原件回扫、独立文件/对象原件存储、原件恢复任务的自动调度、Orders/Items 全字段扩展、财务事件多层金额子表、Ads/Brand/Data Kiosk 的字段级完整覆盖、历史缺口自动补采与实际 API 验收。当前不宣称 P0–P2 全部完成。


## 本轮增量：历史原件字段回扫

新增管理员预览入口：`GET /api/operations/sync-center?section=field-scan-preview&sourceId=...&taskId=...&rawPages=1,2`。返回脱敏清单、recoveryDigest 和可送入现有审批链的 `recover-report` 命令（`fieldScanOnly=true`），预览本身不应用变更。

每次限定同租户、同来源的 executionVersion=2 历史任务及 1–10 个明确原件页；支持非零负页码的失败响应原件。单份密文上限 24 MiB，解码总量上限 16 MiB。解密后校验原始摘要；兼容旧摘要规范，不改写原件。清单绑定来源/授权 revision、任务、原件 hash、元数据摘要、采集时间、scanner version、字段形状及当前映射定义摘要。清单失效后须重新预览，不能把旧批准应用到变更后的原件或映射。

应用只登记字段观察和当前实现映射，并追加 `amazon.sync.fields.archive-recovered` 审计；不请求 Amazon、不改业务事实、不重新发布数据、不修改来源 revision、不生成配置版本。已有观察按原件/scanner version 幂等。该操作明确标记 `CURRENT_IMPLEMENTATION_CATALOGUE_NOT_HISTORICAL_PARSER_REPLAY`，不能冒充按历史解析器重放。

字段映射已去除固定 version=1 的限制：相同定义复用最近版本，定义变化追加下一版本，旧规则不覆盖。并发版本冲突整笔事务回滚，不静默忽略。字段目录仍只证明原件观察和实现映射，结构化/查询验收数保持 null；每字段的业务落库证据仍待补齐。

回退时撤回本轮 API/审批分支和回扫模块即可；已追加的字段观察、映射版本和审计保留。此次增量不新增数据库迁移，不对既有环境运行回扫。

本轮新增验证通过：定向单测 21 项、隔离 runner 单测 185 项、报告链路集成 16 项、源码 typecheck、定向 ESLint 和 diff 检查。验证了摘要损坏/陈旧清单/跨范围拒绝、重复审批回扫幂等、映射追加版本，以及事实、原件、来源 revision、配置版本和 Amazon 请求数量不变。仅使用临时 PostgreSQL/Redis 与 fixture 响应；本轮未重跑完整浏览器/全域离线套件或生产构建，后续合码按仓库检查要求执行。

## 本轮增量：结算字段持久化核对证据

结算解析器每批最多 500 行、在既有 scope lock / run fence / live source 检查的写入事务内，对本来源已归属行的 `AmazonSettlementRow.amountOriginal`、`currencyCode` 做数据库回读。按原始行号与 rowHash 比较当前解析输出，区分匹配、缺行、差异、NULL 和非 NULL；保留金额文本精度。回读差异阻断本批提交和发布，原件已在前一独立事务保存，仍可追溯。

复用 append-only AuditLog 事件 `amazon.sync.fields.persistence-checked`，绑定租户、来源、报告、原件 task/page/hash、字段注册 ID、不可变 mapping ID/version、parser version、目标列和批次行身份摘要。事件只保存计数与身份引用，不保存单元格值、买家数据或原始路径。事件与业务批次同事务提交，重复相同核对幂等；已存在历史通过证据不覆盖后来的差异记录。

只有原件元数据明确为 Reports v2021-06-30 的 V2 settlement 报告、字段扫描完整、精确 `/columns/amount` 或 `/columns/currency` 已观察且当前映射定义匹配时才登记。缺版本、别名列、无归属隔离行不会获得该证据。修正结算映射说明，明确 amount-only 和同 settlement-id 唯一头币种回填规则；规则改变由既有映射版本机制追加，不覆盖旧规则。

字段目录 API / MCP 共用 reader 现在附带 `persistenceEvidence`，每字段最多 5 条，整页查询最多读取 501 条用于截断检测，明确 `persistenceEvidenceMayBePartial` 和整页截断标记。证据表示历史某批写入后回读与解析输出一致，**不代表原始字段含义已官方验证、今天的所有行仍一致、所有历史报告完成或 ERP/MCP 业务查询已验收**。字段级 `structuredPersistenceVerified`、`queryAcceptanceVerified` 及全量验收计数继续保持 false/null。

本增量不新增迁移或真实 Amazon 请求。新增查询均位于已批准结算批次与管理员目录边界，最多每批两个字段；未做生产容量/P95 验收。回退可撤回 processor 调用、字段证据模块和 reader 扩展，保留审计记录和既有业务事实。历史币种修复、旧原件和其他域尚未自动补此证据；不能将现有旧数据默认标为核对通过。

本轮验证：定向单测 9 项、隔离 runner 单测 185 项、结算/报告集成 17 项全部通过；源码 typecheck、定向 ESLint、git diff --check 通过。新增回归覆盖精确金额文本、NULL/空串、原始行身份、证据事务回滚、幂等、差异历史、字段目录与跨 workspace 拒绝。仅变更结算批次与字段 reader，采用对应链路测试；未重跑全域浏览器套件/完整 check 或生产构建，合码前仍须依仓库规则执行。既有数据库写入/迁移、真实 Amazon 请求、commit/push/部署均未执行。

## 本轮升级：赔付、库存事件和库龄字段回读

复用既有报告解析批次，在业务行和归属标记写入后、游标推进/发布之前，回读 `AmazonSyncReportRow`。核对范围扩展到已有映射的金额原文、币种、订单 ID、SKU、ASIN 和数量原文，不建立新的业务事实表或新审批入口。新增库存事件 MSKU → sellerSku 及报告数量原文映射，按解析器实际字段优先级登记；不把库龄分桶 JSON 冒充已经有独立业务列。

赔付与库存事件只对当前 `verified-site-v2` 标记且站点匹配的行核对，未归属、冲突和越界行不产生通过证据。seller-archive-only 模式不启用该核对。库龄记录使用 `EXACT_STORED_BATCH_ONLY`、`siteQualification=NOT_VERIFIED`，不扩大站点归属声明。

先核对同来源原件/报告 hash、Reports v2021-06-30、具体 reportType/reportId；缺版本不推断。字段扫描必须完整，映射必须与当前可执行定义一致。多个原始列映射同一目标列时暂缓这些列的证据登记，例如 Quantity 与 Reconciled/Unreconciled Quantity 同时存在；其他无歧义字段继续核对。原始字段及全部值仍保留在加密原件。

证据沿用 `amazon.sync.fields.persistence-checked` 及字段目录 API/MCP 展示，不改变整个字段的验收状态。事件批量、幂等写入，与对应业务批次同事务；数据库回读差异阻止发布，事务内临时证据回滚，原件和已有解析失败检查点保留。该证据仍只表示所列批次的数据库值与解析器输出一致，不表示解析器语义已经真实 API 验收或历史数据已全量补齐。

单次核对最多 500 行，读取本原件的字段观察与映射，业务行一次回读，证据一次 createMany，避免逐字段写库。没有新增 Amazon 请求、数据库迁移、调度策略或真实环境操作。应用回退可撤回 processor 调用和核对函数，保留原审计与事实；上线前仍须容量/P95 验证。

本轮验证通过：定向单测 10 项、隔离 runner 单测 185 项、报告链路集成 24 项，以及源码 typecheck、定向 ESLint 和 diff 检查。覆盖三域回读、归属隔离、别名歧义、单数量列、扫描不完整、证据幂等、跨 workspace 拒绝，以及真实临时数据库冲突导致停止发布/保留原件与失败检查点。Amazon 响应均为 fixture，未执行真实 API 验收。因改动限定报告链路，本轮不重跑全域浏览器、完整 check 或 CI 生产构建；合码/上线仍按仓库规定执行。未提交、推送、迁移或部署。

## 优先级调整：实际覆盖报告与结算历史重解析闭环

本轮按用户要求停止继续扩充目录范围，先将现有原件转为可查询业务数据。新增 `GET /api/operations/sync-center?section=field-coverage&sourceId=...` 及显式授权工具 `amazon.fields.coverage`。仅管理员，在当前租户、卖家/站点和 MCP source fence 内读取；撤权后拒绝。当前支持四个已有报告域，其他域明确返回尚未实现，不暗示官方目录已完整。

报告分别展示报告原件、有观察的原件、观察/映射字段、已存/已发布业务行、有金额但缺币种的行、业务查询可见行、最近持久化批次证据及批准的币种重解析。业务可见数量复用 `readDomainReports`，沿用发布、归属、快照与日期规则。业务日期筛选只限定业务行；原件、字段、文档状态和持久化证据的全历史范围分别标注。计数与业务查询非同一原子快照，采集期间允许变化。原件包含来源任务及已关联卖家报告行，共享旧档案未关联时可能缺计，不隐藏该限制。

批次证据按 mapping/document/batch 读取范围内保留最新检查，最大 5000 条，截断显式返回。重复批次的行检查次数不冒充唯一业务行，官方总字段数、全量字段完成数和全字段验收继续返回 unknown/false。UI 复用现有数据总览/数据质量覆盖卡片，为管理员增加来源选择和实际覆盖指标；不新建导航模块，不展示原始敏感值。

新增 `section=settlement-currency-preview`，返回指定档案的脱敏清单、digest 和既有审批命令。币种应用后回读站点行，核对数量、rowNumber/rowHash、金额与原解析结果；重扫原件登记现有字段，并对可匹配的卖家级原件补批次持久化证据。每次最多 10 份档案，密文单件 24 MiB、解码总量 16 MiB，超限要求缩小范围。原件、发布头、行身份和金额保持不变，缺失币种不能按站点推断。

修复一个实际逻辑缺口：站点行已补币种而卖家级对应行为空时，旧实现只随站点 patch 更新卖家行，导致漏补。现在两层 patch 独立预览、绑定状态摘要并分组更新。修复为数据操作，不生成来源配置版本；重复申请应用不再撞配置 revision 唯一约束，来源与授权 revision、批准期限、审计及清单摘要校验仍保留。

### 当前真实库实际状态

通过统一根 `.env`、固定已核实本机 PostgreSQL 容器与端口、`READ ONLY` 事务重新审计；结果保存到 `outputs/amazon-field-registry-20261109/actual-settlement-coverage.json`。4 个结算来源的 65,513 条已发布站点明细币种仍全部缺失；Field Registry 迁移尚未应用，实际持久化证据事件为 0。不能将开发/fixture 通过当作这些真实行已修复。

目标业务日期 2026-10-10 至 2026-11-08 相交的 8 份档案中，现有站点明细 16,757 行可以从原件同 settlement-id 的唯一报告头补币种；其中严格落在目标业务日期内为 13,266 行。原行 hash 和金额均无差异。其余原件行不能按原件总数减站点投影就判定丢失。所有数字为本次只读重解析结果，未写回。

可审阅的真实执行清单位于 `outputs/amazon-field-registry-20261109/settlement-live-replay-plan.json`，列明目标本机库、精确来源/档案、关联计划、revision、迁移文件、预期行数和步骤。执行前须暂停清单相关计划、再次确认任务排空，受控应用指定增量迁移，再重新预览、请求/批准/应用、核对业务查询，最后恢复本次暂停且验收通过的计划。旧审批、静态清单和本报告均不能绕过服务端当前范围/状态检查。未执行真实迁移、计划修改、币种写回、Worker 重启、Amazon 请求或服务器部署。

### 验证与剩余边界

本轮通过 12 项定向单测、隔离 runner 的 185 项单测、25 项临时 PostgreSQL/Redis 报告集成与 2 项模拟 API 浏览器验证；typecheck、定向 ESLint 和 diff 检查通过。集成覆盖真实报告头币种重解析到站点/卖家两层修复、原始行身份/金额保持、业务查询读取、独立卖家行补币种、重复审批幂等、覆盖报表计数、MCP 明确授权/站点拒绝/撤权。浏览器验证错误清除旧证据和切来源迟到响应隔离。上述测试使用 fixture，真实库只读审计与 fixture 验收分开记录。

本轮没有新增迁移，依赖已交付但尚未应用的 `20261109020000_amazon_field_registry`。应用回退可撤回本轮 reader/UI/修复代码，保留已追加审计和新增表列，不自动 drop 或盲目回退币种。未运行全域浏览器/完整 check/生产构建，合码和发布前按仓库规则执行。官方模型的全量目录、未实现字段展示、全字段可视化、其余域历史重解析、独立原文件存储和真实 API 全域验收仍未完成；后续先完成本清单真实结算执行与验收，再按订单、库存、财务、退货、广告扩展。

## 2026-11-09 已批准的本机结算币种修复实际执行

用户批准补充清单后，于 09:01–09:04 UTC 在既有本机容器 `amazon-sync-live-postgres`、端口 `127.0.0.1:55439`、数据库 `amazon_sync_live_local`、`amazon-live-local/default` 执行。此节更新前述“尚未应用/尚未写回”的历史状态；不表示服务器发布或 Amazon 全域验收完成。

- 核对目标、四来源 revision=2、授权 revision=3/CONFIGURED、SQL SHA-256 和全部 pending 迁移后，通过既有 `requestChange → decideChange → applyChange` 暂停四个清单计划，revision 6→7。包含 PAUSED 在内的活动任务为 0。
- 标准 `prisma migrate deploy` 成功应用批准的三项迁移：`20261107050000_amazon_buy_box_automatic`、`20261109010000_amazon_order_created_time_index`、`20261109020000_amazon_field_registry`。实际迁移 ledger checksum 与批准 SQL 一致，后续 `migrate status` 无待应用项。未跳过迁移、手工修改 ledger 或变更根 `.env`。
- 对清单精确八份档案，重新预览当前 digest，再逐来源经上述审批服务应用 `currencyOnly`。站点明细补币种 16,757 条，卖家级对应明细亦补 16,757 条；这是同一批业务数据的两层持久化，不能相加称作 33,514 条独立交易。四来源修复数分别为 CAD 1,170、BRL 3、USD 15,544、MXN 40。全部币种来自同 settlement-id 唯一报告头，保存 `SETTLEMENT_HEADER` 和来源行号。
- 两层 row ID/行号/hash/金额摘要、八份加密原件及元数据摘要、站点/卖家报告全部头记录摘要修复前后一致。两层各 16,757 条已修复行缺币种均为 0；重新预览可修复数为 0。业务服务 `readDomainReports` 按既有最大每页 50 条逐页回读八份报告全部 16,757 行，币种缺失为 0。其中目标业务日期 2026-10-10 至 2026-11-08 内为 13,266 行。
- 完成回读后，通过审批服务只恢复本轮暂停的四个计划，revision 7→8、enabled=true。共 12 个申请/批准/应用记录均为 APPLIED，四个币种修复审计已持久化。恢复启用只证明计划状态恢复，不证明 Worker 当前在线或后续补采已经完成。

真实覆盖限制：四来源全历史站点行仍共 65,513 条，剩余 48,756 条缺币种，未在这次八份档案范围内处理。旧原件缺少 API 版本，Field Registry 将实际版本记为 `UNSPECIFIED`，登记 24 个观察字段，映射数和字段批次持久化证据仍为 0；没有推断历史版本或伪造映射通过。修复本身有四个独立审计及完整回读结果，但不能描述为全字段验收或全历史完成。此前没有质量 OPEN 事件且修复后为零时，既有质量服务不凭空追加 RESOLVED 事件。

执行结果及审批 ID、精确 manifest/digest、迁移 checksum、前后摘要和实际覆盖报告见 `outputs/amazon-field-registry-20261109/settlement-live-execution.json`。执行器位于同目录 `execute-approved-settlement-replay.cjs`，仅为本次固定清单的操作记录，不是自动调度入口。验证首次因操作者请求 pageSize=500 超出合同的 50 上限被拒，随后更正为 50，逐页核对全部通过；没有因此重做币种修复。

本轮采用真实本机数据回读和迁移状态/审计核查，没有变更应用业务实现，不重复此前隔离测试、完整 check、浏览器或生产构建。未请求 Amazon、启动或重启 Worker、启动网页、处理其他域、commit/push 或服务器部署。执行进程 HTTP 调用次数为 0；既有自动计划恢复后按原调度运行，其后续请求不包含在本次币种修复计数中。
