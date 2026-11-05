# 订单增量同步 P1（2026-11-05）

P1 历史交付为 `searchOrders` 列表链路。P2 随后按用户确认的新版授权契约加入可选 `getOrder` 详情（见 `docs/amazon-orders-p2-plan.md`）；P3—P5 仍逐阶段等待人工确认。未运行任何真实同步、生产迁移或部署。

## 既有链路摘要（191 字）

HTTP→解析→服务→Prisma事务；凭证DB存AES-GCM密文，保留旧回退；服务/审批验权；绑定AmazonSyncDataSource。BullMQ、租约围栏、密文游标、有限退避；快照run/SKU/condition唯一、分片幂等、成功切head。fixture多内联，fetch mock，临时Docker PG/Redis隔离；npm test仅单测，原无全测单命令。

在线商品为 `catalog`、库存为 `inventory`、日报为 `sales_traffic`。服务直接使用 Prisma，不新增 repository 框架；新模块沿用 `amazon-sync`、现有审批、队列、storage/加密边界。旧三链路不切换到订单的增量模型。

## 官方依据与差异

- 新增唯一业务端点：Orders **v2026-01-01** `GET /orders/2026-01-01/orders` / `searchOrders`。
- 官方参考：https://developer-docs.amazon.com/sp-api/reference/searchorders
- 官方模型：https://github.com/amzn/selling-partner-api-models/blob/main/models/orders-api-model/orders_2026-01-01.json
- 仓库证据：`docs/amazon-sync-center-phase0/official-model-evidence.json` 的该版本条目。本次又读取了官方模型的操作/响应定义片段；未声称重新下载并校验了完整模型及其 SHA256。
- 新版使用 `lastUpdatedAfter` / `lastUpdatedBefore` / `marketplaceIds` / `paginationToken`；响应 `pagination.nextToken` 转为下一请求的 `paginationToken`，不使用 v0 大写参数。
- 本仓库没有接入运行中的 Orders v0 同步；历史官方证据保留 v0 仅用于版本对照，不新增 v0 模型。
- 新版状态读取 `fulfillment.fulfillmentStatus`，不是 v0 的 `OrderStatus`；`rawStatus` 保留原值，内部状态由配置映射，未知或 null 保留未映射。不得把旧状态名称直接套进新版。
- 仅请求 `includedData=FULFILLMENT`，不请求买家、收件人、款项、包裹等详情数据集；事实表不提取订单商品或金额。原始响应可能包含基础商品属性，因此原始留档全体加密且不开放 UI/普通读接口。
- **2026-11-05 P2 官方核验及用户决定**：[Access Orders PII](https://developer-docs.amazon.com/sp-api/docs/access-orders-pii) 和 [Get order information](https://developer-docs.amazon.com/sp-api/docs/get-order-information) 明确新版无需 RDT；用户已确认采用 LWA + 已批准 restricted roles，Orders 不申请 RDT。FULFILLMENT 可含商品礼品留言，基础商品定制 URL 也是敏感字段；当前事实表仍只提取白名单，raw 整体加密，coverage 将 `factsContainPii:false` 与 `rawMayContainPii:true` 分开，`piiCollected:null` 表示未断言字段可见性。实现和验证见 `docs/amazon-orders-p2-plan.md`。

## 阶段与文件

| 阶段 | 延伸现有位置 | 验收与放行 |
| --- | --- | --- |
| P1 当前 | `amazon/sp-api-client.ts`；`amazon-sync/orders.ts`、`orders-rate-limit.ts`、`orders-query.ts`；现有 service/processor/审批；Prisma 增量迁移；sync-center GET 与订单面板 | 离线 HTTP fixture、真实临时 PG/Redis、幂等、分页、恢复、错误、权限零请求、浏览器；结束后停在 P1 |
| P2 待确认 | 同一 Orders 模块/模型、现有凭证边界；具体文件以 P1 审查结论为准 | 先确认新版 PII/RDT 官方契约；金额字符串→Decimal、详情权限、敏感缓存测试 |
| P3 待确认 | 现有 SP 客户端、`amazon-sync` 财务适配器、同目录 service/processor、Prisma migration | Finances v2024-06-19 真实字段唯一键、逐页提交、角色、汇率配置 |
| P4 待确认 | 现有 Reports 客户端/报告适配器，不新建 HTTP 客户端 | 确定一个 reportType；轮询退避/404、压缩、TSV、受限文档与行 hash |
| P5 待确认 | 现有 scheduler、观测、审批、README | 三资源统一调度契约、完整跨资源回归、每阶段独立 PR 和上线审查 |

后续阶段不预先生成无法核实的文件名或迁移，具体改动清单在进入该阶段前提交审阅。

## 配置与使用

1. 在“店铺与授权”保留现有 Seller/Marketplace/区域绑定。区域 endpoint 仍从已批准授权读取，并校验既有区域配置表，订单模块不硬编码 NA/EU/FE。
2. 管理员核对 Developer Console 已批准角色，录入 `approvedRoles`。这是审批留痕的人工声明，**不是 Amazon 端角色已验证的证明**。更新授权后沿用原行为重新验证参与站点；本次没有执行这些真实操作。
3. 绑定 `orders` 数据源，填写非敏感策略：`initialFrom`（明确 UTC 起点）、`marketplaceTimeZone`（人工确认 IANA 时区）、`applicationId`（非密钥应用标识）、`windowMinutes`、`overlapSeconds`、`safetyLagSeconds`、`requestsPerSecond`、`burst`、`requiredRoles`、`statusMapping`。
4. 数值表单初值仅为可编辑运行参数，不预填真实卖家/站点/时区/角色/状态口径。窗口 1—1440 分钟，重叠必须小于窗口，延迟至少 120 秒，searchOrders 配置上限 0.0056 rps / burst 20。同一授权的各站点必须使用相同应用标识和预算；既有应用标识不允许原地改换。
5. “同步此范围”只创建审批。服务端计算并冻结**一个**窗口；批准与应用分开。没有游标时使用管理员选择的首次起点；已完成则带重叠推进，未完成则恢复原窗口。不得每次回扫全部历史。
6. P1 不开放自动周期计划，不把已批准配置视为永久执行授权。限流等待持久化 `nextAttemptAt` 后释放执行槽，不 sleep 占用 Worker。
7. “订单列表”提供工作区/店铺/站点/订单 ID/UTC 更新日期筛选与 50 行分页；未完成窗口明确标记。数据为已提交页的当前事实，不冒充不可变快照，不保证全量历史已覆盖。

## 持久化、恢复与安全

- `AmazonOrderRecord`：业务唯一索引 `(organizationId, workspaceId, amazonSellerId, marketplaceId, amazonOrderId)`，额外租户/卖家维度防串数据。重复执行行数不变；旧更新时间不覆盖新版本；同时间冲突字段停止提交。
- `AmazonSyncResourceCursor`：每 source 一行，保存 resource/seller/site、watermarkFrom/To、AES-GCM 加密 nextToken、activeRun、lastSuccessAt/status。游标和业务页、页去重证据、加密 raw 留档同事务提交。失败保留之前成功页，从失败页继续；不自动回到第一页。
- `AmazonSyncRawPage`：成功提交页的精确原始 JSON 文本加密留档，带请求元数据、RequestId、内容 SHA256；上下文含租户和 run/page。金额即使出现在 raw 中也不经 JS 数值转换再归档。普通查询不返回密文、明文、分页 token。失败响应仅记脱敏状态，不保存异常栈/上游错误正文。
- `AmazonSyncRun`：复用 run_id、起止时间、请求/插入/更新/跳过/429，新增 failedCount（失败尝试计数，不是失败订单数）。响应状态与 x-amzn-RequestId 结构化留痕；400/403/404 不自动重试，429 指数退避和抖动、5xx 有限重试；订单 404 行为不代表未来 Reports“未就绪”404 策略。
- `AmazonSyncTokenBucket`：PostgreSQL 持久化 token bucket，以卖家/应用/操作的哈希键跨站点共享，短事务 advisory lock；响应限流头向下校正预算。不同授权代表同一真实应用时，也必须由管理员统一配置同一非敏感应用标识。
- access token 保存在进程内存，expires_in−5 分钟过期；订单按租户/授权版本和凭证摘要共享刷新 Promise，覆盖跨客户端实例单飞。不同进程不承诺全局单飞；本地锁符合本阶段契约，进程内最多 1000 个授权版本，达到上限时失败关闭，须受控维护重启。本次没有执行重启。
- refresh token 继续现有 AES-256-GCM/AAD 存储，不更换服务器密钥。解绑/停用订单绑定立即取消并 fence 关联订单任务，保留恢复游标；旧资源生命周期加固留到 P5。
- token 过期/窗口超限不会自动丢游标或偷偷全量重拉，需人工核查并重新审批。完整 raw 重放只能进入隔离 fixture，不提供生产回放入口。
- 不改变 ProductRecord、PPC IndexedDB、现有库存/日报的事实源或发布规则。

## 一条命令离线验收

```bash
npm run test:amazon-orders:offline
```

命令包含 P1 单元测试、相关旧链路单元回归、真实临时数据库集成和订单浏览器 fixture。预装 Docker `postgres:16-alpine`、`redis:7`、仓库依赖及 Playwright 浏览器；缺失就失败，不自动下载镜像/浏览器/依赖。测试专用凭证全是虚构 `.invalid` fixture。

runner 不继承实际 DATABASE_URL、Redis、密钥或 dotenv 配置；使用随机命名临时容器、loopback 动态端口、临时 storage。Prisma 使用临时配置绕过项目 dotenv。Node 预加载 guard 拒绝外部 TCP/TLS/DNS/UDP 和未 mock fetch。浏览器所有页面/API 由本地 route.fulfill 接管，不登录生产。新 P1 测试不含真实 sleep，时间由注入 clock 或 fixture 任务时间推进。

```bash
# 扩大到原有六组集成回归及订单浏览器
npm run test:amazon-sync:offline
# 核心单测；源码 lint；类型检查
npm test
npm run lint -- --ignore-pattern '.next-amazon-live/**'
npm run typecheck
```

扩大的旧回归仍保留既有虚构响应与历史官方 URL 字面量、少数本地 DB 锁等待轮询；没有把这些旧测试冒称为新 P1 的零 sleep fixture。所有远程连接仍由 guard 阻断。默认 check:fast 的 eslint 会误扫工作区已有 `.next-amazon-live` 生成产物；不删除用户产物、不为此改全局构建/lint 配置。源码 lint 单独排除该生成目录。

## 迁移、回滚与性能边界

- 迁移：`prisma/migrations/20261105030000_amazon_orders_incremental/migration.sql`，只在临时库验证过。保留旧 CHECK 分支，新增 orders/incremental 分支和表/列/索引；没有生产 apply。
- 上线前必须审查整个工作区、原有未提交改动和迁移序列，通过现有 CI artifact 流程；不把其他聊天的改动悄悄带入 P1 PR。
- 回滚使用订单数据源停用/功能入口回退，数据库迁移只向前，不自动删表/列/恢复库；加密证据与游标留存。部署旧应用前检查授权 revision、CHECK 和新字段兼容性。
- 每次仅处理一页，页上限 100、窗口最多 1000 页/50000 行；短事务逐行 upsert、索引分页、最多 200 数据源。每页增加一个预算/遥测事务和加密 raw 写入，会增加 DB 写入与存储，不能据此承诺生产 P95。raw 保留期限与大规模容量要人工拍板。

## 运维策略与待人工确认

- 项目保守策略：client secret 每 180 天轮换，refresh token 按每年重新授权管理。轮换不能直接覆盖旧加密主密钥；经审批更新授权后重新验证，审查旧任务版本/游标。Application Management 自动化仅为后续选项，本次不新增端点或真实轮换任务。
- 确认真实站点时区、首次同步起点、窗口/重叠/安全延迟和调用预算。
- 核实 `requiredRoles` 与已批准角色，确认人工 attestation 的责任人；P1 不把通用参与站点验证等同于 Orders 权限。
- 确认新版 `fulfillmentStatus` 到 ERP 状态的映射，尤其取消、待付款、部分履约及未知枚举；当前未映射一律 null。
- P2：核实新版 PII/RDT 官方授权依据、用途和保留期，确定金额/currency/订单明细字段。
- P3：官方交易唯一标识、非订单交易分类、汇率来源/时点/版本、精度和折算口径。
- P4：只选择一个获准 reportType，确认 FBA/FBM 范围、受限性、字段与退货原因维度；Customer Feedback 暂不并行接入。
- 确认加密 raw 的保留期、访问审批、清理策略、存储预算；当前无自动清理。
- 确认既有工作区改动如何分 PR；本阶段只形成本地可审阅实现与 PR 说明，不擅自推送混合改动。
