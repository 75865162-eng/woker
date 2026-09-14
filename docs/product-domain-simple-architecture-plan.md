# Product Center 性能优化与架构收口

## 1. 文档定位

本文不是新 ERP 功能开发方案，而是基于当前代码进度对 Product Center 做性能审计、架构收口和生产可维护性确认。

本轮目标：

- 让 50 人以内、约 1,000-10,000+ SKU 的商品列表保持可用和可扩展；
- 优先保证列表首屏、搜索、筛选、分页、图片缩略图和详情打开速度；
- 继续以 `ProductRecord` 作为商品核心资料的 Source of Truth；
- 不因为“生产级”而强制引入 Redis、更多 Projection、微服务或新的 Read Model；
- 把已经存在的投影、缓存和媒体结构逐个定性，避免多套数据源继续扩大；
- 在完成真实 benchmark 前，不宣称性能优化已经完成。

当前阶段的最高优先级：

1. 商品列表数据库查询和首屏；
2. 缩略图网络请求和浏览器渲染；
3. 搜索、筛选、分页和快速切换的响应；
4. 商品详情单请求聚合；
5. payload 大小和前端内存；
6. 缓存是否确实带来收益。

## 2. 当前真实规模和约束

当前按以下规模进行设计和验证：

- ERP 用户：约 50 人；
- 商品规模：约 1,000-10,000+ SKU；
- 高频页面：商品列表和商品详情；
- 高频商品信息：SKU、ASIN、中文/英文名称、主图、状态、负责人、供应商、规格、关键词和备注；
- 其他 ERP 页面：当前使用频率相对较低；
- 技术栈：Next.js、React、TypeScript、Prisma、PostgreSQL、Zustand、现有 Worker / Outbox / Storage。

当前不提前引入：

- Kafka、RabbitMQ、Kubernetes；
- 微服务和 Elasticsearch；
- 大规模 CQRS 或 Event Sourcing；
- Redis Everywhere；
- 新的复杂图片服务；
- 新的商品 Read Model。

只有真实查询、网络或渲染 benchmark 证明当前技术栈不足时，才扩大架构。

## 3. 当前真实架构判断

### 3.1 核心事实源

```text
ProductRecord
  = 商品核心资料 Source of Truth
  = 版本 revision 的事实来源
  = 商品保存、审计和 Outbox 的事务中心
```

`ProductRecord.payload` 不删除，继续承载原始、兼容和不适合高频查询的扩展结构。参与筛选、排序、统计或权限判断的稳定字段已经逐步提升为普通列。

### 3.2 当前保存链路

```text
UI
  -> Product API / Product Aggregate Service
  -> PostgreSQL transaction
       ProductRecord
       attachment bindings
       audit/version records
       ProductOutboxEvent
       revision + 1
  -> enqueue worker
  -> Worker 读取当前 ProductRecord
  -> Summary / Text / List Summary / Product Center 投影
```

当前 Redis/BullMQ 主要用于异步任务调度，不是商品事实数据存储。

### 3.3 当前列表链路

```text
Product Workbench
  -> GET /api/products
  -> 权限 + organization + workspace scope
  -> ProductSummaryRecord
       LEFT JOIN ProductTextRecord(language = default)
  -> 数据库过滤、排序、OFFSET/LIMIT 分页
  -> ProductListItem
  -> ProductTable
  -> useVirtualRows 只渲染可见行和 overscan 行
```

当前列表接口实际使用的字段包括：

- `sku`
- `asin`
- `chineseName`
- `englishName`
- `status`
- `selectionOwner`
- `opsAssignee`
- `designerAssignee`
- `currentOwner`
- `workflowStage`
- `createdAt`
- `updatedAt`
- `purchasePrice`
- `supplierName`
- `workflowDueAt`
- `isOverdue`
- `specs`
- `keywords`
- `note`
- `primaryImageUrl`

列表 SQL 只读取列表所需字段；正常情况下主图来自 `ProductSummaryRecord.primaryImageUrl`，仅在投影缺失或 revision 未追平时读取 `ProductRecord.payload` 中第一张图片的最小 URL/asset id 作为兜底，不把完整商品 JSON 发送到浏览器。

### 3.4 当前详情链路

```text
Product Workbench
  -> GET /api/products/:sku/detail
  -> ProductDetailService
  -> 一次服务层聚合读取：
       ProductRecord.payload
       ProductSummaryRecord
       ProductTextRecord
       ProductProjectionState
       ProductMaster
       ProductVariant
       ProductListing
       ProductSupplier
       ProductCost
       ProductMedia
  -> Detail DTO
  -> 商品编辑器
```

详情是单一主要 Detail API，当前没有前端请求瀑布。投影缺失不会让主记录返回 404，详情会返回 `projection.status`。

### 3.5 当前图片链路

```text
上传图片
  -> Storage 保存原图
  -> sharp 生成 160x160 以内 WebP 缩略图
  -> FileObject 记录原图和缩略图元数据
  -> ProductRecord.payload.imageAssets 保存引用
  -> ProductMedia 投影保存媒体索引
  -> 列表只取 primaryImageUrl / thumbUrl
  -> 详情按需读取 thumbUrl / originalUrl
```

当前列表图片组件已经使用：

- `loading="lazy"`
- `decoding="async"`
- `fetchPriority="low"`
- `thumbUrl` 优先；
- 图片失败时显示占位；
- `useVirtualRows` 配合可见行渲染。

当前文件下载接口返回 `private, max-age=3600`，但尚未形成统一的 immutable 内容寻址缓存策略。该项需要在 benchmark 和存储策略确认后再优化。

## 4. 当前性能能力盘点

| 能力 | 当前状态 | 结论 |
| --- | --- | --- |
| 数据库过滤 | 已有 | 搜索、状态、负责人、供应商、价格等在数据库条件中执行 |
| 数据库分页 | 已有 | `/api/products` 使用 `OFFSET/LIMIT`，默认页面不是全量加载 |
| 列表字段裁剪 | 已有 | 查询 Summary/Text 字段，不读完整 payload |
| 列表虚拟化 | 已有 | `useVirtualRows`，当前页面只渲染可见行 |
| 列表图片缩略图 | 已有 | `thumbUrl` 优先，上传时生成 160px WebP |
| 图片懒加载 | 已有 | `loading=lazy`、异步解码、低优先级 |
| 前端请求缓存 | 已有 | 列表、summary、详情有进程内短 TTL / in-flight 去重 |
| 服务端列表缓存 | 已有 | 内存 `Map` + `ProductListCacheRecord` PostgreSQL 缓存表 |
| Redis 商品缓存 | 未实现 | Redis 当前不应被描述为商品缓存层 |
| 详情聚合 | 已有 | `ProductDetailService` 统一 DTO |
| 投影失败状态 | 已有 | `ProductProjectionState`、Outbox 重试和 repair |
| 真实 benchmark | 未完成 | 不能据此宣称性能收口 |
| P50/P95/P99 观测 | 部分具备 | 列表接口提供 Server-Timing；健康接口提供 Outbox、投影和读模型漂移指标，但仍不能替代完整压测报告 |

## 5. 数据责任和 Source of Truth 收口

### 5.1 责任表

| 数据或组件 | 责任 | 是否事实源 |
| --- | --- | --- |
| `ProductRecord` | 商品核心资料、payload、revision、普通查询字段 | 是 |
| `ProductRecord.payload` | 原始/兼容/低频扩展数据 | 是，隶属 ProductRecord |
| `ProductMedia` | 商品媒体关系和媒体元数据的结构化索引 | 否，必须可由 ProductRecord 和 FileObject 重建 |
| `FileObject` / Storage | 原图、缩略图等二进制对象 | 文件事实和存储元数据 |
| `ProductSummaryRecord` | 列表字段、筛选字段、主图缩略图的派生读模型 | 否 |
| `ProductTextRecord` | 列表或详情需要的文本拆分读模型 | 否 |
| `ProductListSummaryRecord` | workspace 统计汇总 | 否 |
| `ProductProjectionState` | 投影状态、revision 和失败状态 | 运行状态，不是商品资料事实源 |
| `ProductListCacheRecord` | 列表响应短期缓存 | 否 |
| 进程内 `Map` | 单实例请求/页面缓存 | 否 |
| Redis | 可选缓存或 BullMQ 调度设施 | 否 |

### 5.2 禁止的多写模式

禁止形成以下链路：

```text
A 表手动修改
  -> B 表手动修改
  -> C 表手动修改
  -> Redis 手动修改
```

正确方向：

```text
ProductRecord transaction
  -> Outbox
  -> 可重建 Projection
  -> 删除/失效 Cache
```

Projection、ProductMedia 和缓存都不能反向覆盖 `ProductRecord`。

### 5.3 图片引用的当前风险

当前图片信息同时存在于：

- `ProductRecord.payload.imageAssets`；
- `ProductSummaryRecord.primaryImageUrl`；
- `ProductMedia`；
- `FileObject`；
- 列表 DTO 的 `image` 字段。

目前通过 `ProductRecord` 投影和 `sourceRevision` 维持一致，但这仍是需要持续审计的重复表示。

收口原则：

1. 二进制只在 Storage / FileObject；
2. 商品资产关系以 ProductRecord 中的引用为写入事实；
3. `ProductMedia` 只作为结构化媒体索引和详情关联；
4. `ProductSummaryRecord.primaryImageUrl` 只作为列表派生字段；
5. 删除或替换图片必须由统一附件绑定/商品聚合服务处理；
6. 不允许业务 API 独立手改 Summary、Media 或缓存。

## 6. Read Model 和 Cache 审计结论

### 6.1 `ProductSummaryRecord`

当前用途：

- 商品列表主读路径；
- 列表筛选、排序、分页；
- 主图缩略图；
- 部分看板统计。

当前决定：**保留，但暂不宣布永久保留。**

原因：

- 当前真实列表 SQL 仍读取该表；
- 该表字段完整覆盖当前列表；
- 已有索引和投影失败降级；
- 直接切回 `ProductRecord` 需要结果对比、历史脏数据检查和 P95 证据。

后续只有在以下条件满足后，才评估把列表主路径迁回 `ProductRecord`：

- ProductRecord 普通列查询结果与 Summary 逐页一致；
- 常用筛选和搜索有足够索引；
- P95 没有明显恶化；
- 历史脏数据不会造成列表差异；
- 有可切换回 Summary 的开关或回滚代码。

### 6.2 `ProductTextRecord`

当前用途：

- 列表展示 `specs`、`keywords`、`note`；
- 详情在投影 revision 对齐时补充文本；
- 避免列表读取完整 payload。

当前决定：**保留，限制新增字段。**

如果未来列表不再展示这些文本，或 ProductRecord 普通字段查询已经足够快，可重新评估收缩，但本轮不删除。

### 6.3 `ProductListSummaryRecord`

当前用途：

- workspace 商品数量和阶段统计；
- `summaryOnly` 请求；
- 列表顶部统计卡片。

当前决定：**保留，作为可重建汇总。**

它不是商品资料事实源。统计不一致时，必须能够从当前商品数据重新构建。

### 6.4 `ProductListCacheRecord`

当前用途：

- `/api/products` 列表响应缓存；
- 进程内 `Map` miss 后的共享 PostgreSQL fallback；
- 30 秒左右短 TTL。

当前决定：**暂时保留，不迁移 Redis。**

原因：

- 当前 Redis 主要承担 BullMQ；
- 列表复杂 query 组合多，Redis 命中率和失效成本尚未证明；
- PG 缓存表已有降级和过期清理路径；
- 当前没有 benchmark 证明迁移 Redis 能改善 P95。

### 6.5 `ProductProjectionState` / Outbox

当前决定：**保留。**

它们解决的是可靠投影、失败恢复、revision 防旧事件覆盖，不是为了单纯加速而存在。

### 6.6 Product Center 结构化关系表

`ProductMaster`、`ProductVariant`、`ProductListing`、`ProductSupplier`、`ProductCost`、`ProductMedia` 当前属于 Product Center 结构化关系/索引数据，不应全部归类为“缓存”。

当前决定：

- 作为详情真实业务数据保留；
- 不新增同义关系表；
- 明确它们的写入边界和 `sourceRevision`；
- 继续允许从 ProductRecord 投影重建；
- 未有实际调用方和性能收益的字段不再继续扩展。

### 6.7 商品域生产观测

`/api/system/worker-health` 在当前登录用户的 organization/workspace 范围内输出：

- ProductOutboxEvent 的 queued/running/failed 数量；
- 超过 stale recovery 阈值仍处于 running 的事件数量；
- ProductProjectionState 的 pending/processing/failed 数量；
- ProductRecord 与 Summary/Text 读模型缺失或 source revision 漂移数量。
- 当前 revision 缺失的 ProductProjectionState 数量。

这些指标只读数据库，不改变商品状态；健康接口失败不会改变 Outbox 重试和 repair 机制。它们用于上线后的告警和人工排查，不能替代压测。

详情投影状态会同时校验 `sourceRevision`：旧 revision 的失败或处理中状态不会覆盖当前商品 revision 的真实状态。投影事务提交后，如果缓存失效或 Outbox 完成标记更新失败，只会重试 Outbox，不会把已经提交成功的读模型重新标记为失败。

Summary 投影会继承 `ProductRecord.createdAt`，不会把投影执行时间写成商品创建时间。这样 repair、重试和延迟投影不会改变列表默认排序，也不会改变没有明确 `workflowDueAt` 时的超期计算基准。

超期规则统一由 workflow 层提供：终态不超期；有 `workflowDueAt` 时按截止时间判断；没有截止时间时按 `ProductRecord.createdAt` 超过 3 天判断。商品行、列表筛选和顶部 summary 使用同一规则。

Outbox 处理会同时校验事件中的 organization/workspace 与商品事实记录的作用域；当旧事件处理到更新后的商品时，投影失败状态使用事务实际锁定的当前 revision，而不是事件 payload 中可能过期的 revision。

Product Center 的 listing 投影会先删除同一商品、organization/workspace 下不再对应当前账号、marketplace、SKU 的旧 listing，再写入当前 listing。账号或 marketplace 变更不会在详情中残留旧关系。

执行 `products:repair-projections` 后，会按 organization/workspace 主动失效内存和 PostgreSQL 列表响应缓存；repair 不会让用户继续读取旧列表，缓存仍然只是可丢失的读优化层。

## 7. Redis 使用结论

### 7.1 当前事实

当前 Redis 的确定用途是：

- BullMQ 队列调度；
- Worker 运行时依赖；
- 运维健康检查。

当前没有商品详情 Redis 缓存实现。因此文档和代码不得把以下链路写成当前事实：

```text
GET /api/products/:sku
  -> Redis
```

当前实际是：

```text
GET /api/products/:sku/detail
  -> ProductDetailService
  -> PostgreSQL + ProductRecord + 关联数据
```

### 7.2 缓存准入

只有同时满足以下条件，才允许进入 Redis：

1. 高频读取；
2. 重算或数据库关联成本明显；
3. 允许短时间最终一致；
4. 可以从 PostgreSQL 重建；
5. key 能包含 organization、workspace、SKU、权限和响应版本维度；
6. 保存、附件变更、版本恢复后可以失效；
7. 不包含原始二进制、密钥或大体积 payload。

### 7.3 接入优先级

建议顺序：

1. 先完成列表和详情 benchmark；
2. 若详情关联查询确实是热点，再缓存 `GET /api/products/:sku/detail` 的轻量 ready 响应；
3. 若 summary 聚合确实放大数据库压力，再缓存 workspace summary；
4. 最后才评估默认第一页列表；
5. 复杂筛选列表默认不迁 Redis。

详情缓存必须：

- 先权限校验，再读缓存；
- key 包含 organization、workspace、规范化 SKU、图片模式和 DTO 版本；
- 只缓存 `projection.status = ready`；
- 不缓存带 workbook 原图或大附件的响应；
- 保存、附件、视频方案、版本恢复后主动失效；
- miss/error 直接回 PostgreSQL；
- Redis 故障不能影响商品详情。

Redis 不保存图片二进制。图片使用 Browser Cache、Storage/CDN Cache 和合适的 `Cache-Control`。

## 8. 前端列表与图片现状

### 8.1 已经完成

- 页面按页请求商品，默认 page size 为 20，可选 50/100；
- 不会初始化请求 1,000 或 10,000 条商品；
- `ProductTable` 使用 `useVirtualRows`；
- virtual rows 使用 overscan，避免渲染全部当前页行；
- 列表图片只取第一张 `thumbUrl`；
- 图片使用 lazy loading、async decoding、low fetch priority；
- 图片失败有占位状态；
- 商品详情按 SKU 按需请求；
- 列表、summary、详情有客户端短 TTL 和请求去重。

### 8.2 当前不足

- 当前页面仍允许 page size 100，需通过真实设备和浏览器测试确认可接受；
- 当前列表不是跨页无限滚动，而是分页 + 当前页虚拟化；
- 列表采用 `OFFSET/LIMIT`，当页码很深时可能出现大 OFFSET 成本；
- 图片 URL 当前主要通过文件下载路由提供，尚未统一为内容寻址 immutable URL；
- 前端有 `Product` / `ProductListItem` 两套消费类型，需继续确认列表响应不会意外带入完整字段；
- `/api/products` 的搜索条件覆盖 SKU、productRecordId、中文名、英文名和 `ProductTextRecord.keywords`，列表结果和筛选 total 使用同一份 SQL 条件。

### 8.3 暂不做

- 不为当前规模引入新的虚拟化库；
- 不把分页改成无限滚动，除非真实使用数据显示分页已经成为主要体验瓶颈；
- 不把所有图片预加载；
- 不把原图放入列表响应；
- 不把商品详情拆成多个前端请求；
- 不为了图片缓存把二进制放 Redis。

## 9. 数据库和查询风险

### 9.1 已确认的正向边界

- 查询带 organization/workspace；
- 列表由数据库执行过滤；
- 列表由数据库执行排序和分页；
- 列表 SQL 明确选择字段；
- ProductRecord 有 workspace、状态、负责人、价格、ASIN、中文名等索引；
- ProductSummaryRecord 也有对应列表索引；
- 详情使用 Prisma select 和关联过滤；
- projection 使用 source revision 防止旧事件覆盖新资料；
- `/api/system/worker-health` 在 organization/workspace 范围内输出商品 Outbox 积压、超时运行、投影失败和 ProductRecord/读模型版本漂移。

### 9.2 仍需 benchmark 或专项验证

- `contains + insensitive` 在 10,000+ SKU 下的搜索 P95；
- 多负责人、多条件组合筛选 P95；
- 深页 `OFFSET/LIMIT` 的性能；
- `ProductSummaryRecord LEFT JOIN ProductTextRecord` 的查询计划；
- summary 重建对数据库 CPU 的影响；
- 详情 Product Center 关联查询的 P95；
- 1,000/5,000/10,000 SKU 下响应 payload 和 Node 内存；
- 多用户同时搜索、筛选、打开详情时的连接池表现。

没有这些数据，不应直接宣称数据库已经达到生产性能目标。

## 10. Benchmark 计划

本轮文档状态必须区分“已实现”和“已验证”。

### 10.1 数据规模

- 1,000 SKU；
- 5,000 SKU；
- 10,000 SKU。

### 10.2 列表操作

- 首次打开；
- SKU 搜索；
- ASIN 搜索；
- 中文/英文名称搜索；
- 关键词搜索行为确认；
- 状态筛选；
- 负责人筛选；
- 价格范围；
- 分页切换；
- 连续滚动；
- 快速滚动；
- 反复打开同一页。

### 10.3 图片操作

- 首屏缩略图加载；
- 滚动到新行时缩略图加载；
- 浏览器缓存命中；
- 浏览器缓存未命中；
- 缩略图 404 或权限失败；
- 详情原图打开；
- 多图详情内存占用。

### 10.4 记录指标

- API response time：P50/P95/P99；
- DB query time：P50/P95/P99；
- SQL query count；
- response payload bytes；
- cache hit/miss；
- PostgreSQL CPU 和连接池；
- Web/Worker 内存；
- 浏览器长任务和 React commit 时间；
- 图片请求数量、失败率和总字节数。

### 10.5 验收门槛

建议初始目标：

- 普通商品列表 P95 小于 800ms；
- 商品详情 P95 小于 500ms；
- 商品保存 P95 小于 1s；
- 首屏不请求非当前页商品；
- 列表不请求原图；
- 虚拟列表不产生全量 DOM 行；
- Redis 或缓存故障时核心商品读路径仍成功。

这些是验收目标，不是当前已经测得的结果。

### 10.6 可交接 benchmark 工具

已增加 `npm run products:benchmark`，脚本只接受独立的
`PRODUCT_BENCHMARK_DATABASE_URL`，并要求显式提供
`PRODUCT_BENCHMARK_ORGANIZATION_ID` 与 `PRODUCT_BENCHMARK_USER_ID`。

脚本会为 1,000/5,000/10,000 SKU 创建临时 benchmark workspace，测量：

- Summary/Text 列表首屏；
- 关键词搜索列表；
- 与列表条件一致的关键词 count；
- ProductRecord 详情源数据读取；
- P50/P95/max 延迟和响应 payload bytes。

每个规模完成后删除临时 workspace。该脚本不执行 migrate，不连接默认
`DATABASE_URL`，也不会自动修改现有业务 workspace。HTTP API、浏览器和并发
指标仍需在独立环境补测。

## 11. 分阶段收口路线

### 阶段 A：当前代码审计

状态：**已完成代码层初审**

- 确认列表真实读路径；
- 确认详情真实读路径；
- 确认图片缩略图和 URL 路径；
- 确认已有投影、缓存和队列；
- 确认前端分页和虚拟行。

### 阶段 B：性能 benchmark

状态：**工具已具备，实测未完成**

- 已提供隔离 benchmark 脚本，可准备 1k/5k/10k SKU 测试数据；
- 记录 API、SQL、网络和浏览器指标；
- 对比 Summary 主读路径和 ProductRecord 直接读路径；
- 根据数据决定是否需要改列表查询、索引或缓存。

### 阶段 C：最小修复

仅允许修复 benchmark 明确证明的问题：

- 慢 SQL；
- 缺失或不匹配索引；
- 大 payload；
- 图片原图误入列表；
- 不必要的 React 重渲染；
- 深页分页问题；
- 关键词搜索语义缺失（已完成：后端搜索和筛选 total 已同步）。

禁止借机扩大为新的架构项目。

### 阶段 D：最终复审

- 再次确认唯一事实源；
- 确认 Projection 可重建；
- 确认缓存可丢失；
- 确认图片二进制不进 Redis；
- 确认没有旧 API 旁路读写；
- 输出 benchmark 前后对比；
- 输出回滚和剩余风险。

## 12. 保留、删除、合并决策

### 保留

- `ProductRecord`；
- `ProductRecord.payload`；
- `product-record-repository.ts`；
- `product-aggregate-service.ts`；
- `ProductDetailService`；
- revision 乐观锁；
- Audit / DataChangeVersion；
- `ProductOutboxEvent`；
- Worker 和 stale recovery；
- `ProductMedia` 及 FileObject 存储边界；
- `ProductSummaryRecord`；
- `ProductTextRecord`；
- `ProductListSummaryRecord`；
- `ProductProjectionState`；
- `product-list-cache.ts`；
- `ProductListCacheRecord`。

### 暂不删除

- Summary/Text 投影；
- PG 列表缓存；
- Product Center 关系表；
- Redis/BullMQ；
- repair 脚本。

删除这些结构需要 benchmark、历史数据一致性检查、迁移和回滚证据。本轮没有满足删除条件。

### 合并方向

- 商品保存统一经过 Product Aggregate Service；
- 详情统一经过 ProductDetailService；
- 新缓存统一经过 CacheAdapter；
- 图片写入统一经过附件绑定和 Storage/FileObject 边界；
- 投影、缓存失效和 revision 使用同一套 ProductRecord 版本语义。

### 已删除的旧商品路径

旧数据兼容不再作为目标，已通过迁移删除以下独立商品事实源和旁路：

- `SellfoxProductRecord` 及其在线商品 API；
- `ProductImageCopyGalleryRecord` 及其独立图片文案 Gallery API；
- 旧商品来源标记和 Sellfox 商品 summary 分桶；
- 旧商品附件绑定只标记为 `orphan`，不删除 `FileObject` 二进制。

Sellfox 仅保留店铺、小时指标、产品表现快照和同步运行记录等报表数据。

以下结构不是旧事实源，而是当前仍保留的可重建读模型或基础设施：

- `ProductSummaryRecord` 列表主读路径；
- `ProductTextRecord` 列表文本补充；
- PG 列表缓存；
- Product Center 关系投影；
- Redis/BullMQ 和 repair 脚本。

## 13. 数据一致性和生产风险

### 风险等级

当前属于 **架构收口风险 / 性能验证缺口，P1-P2**，不是已确认的商品数据丢失故障。

### 主要风险

1. `ProductRecord.payload.imageAssets`、`ProductMedia`、`ProductSummaryRecord.primaryImageUrl` 存在重复表示，投影失败时可能短暂不一致；
2. 列表依赖 Summary/Text，若投影延迟，列表可能落后于 ProductRecord；
3. 列表搜索已覆盖关键词，但仍依赖 Text 投影 revision 对齐，投影延迟时新关键词可能暂时不可搜；
4. PG cache 和前端 cache 都是最终一致，失效失败时存在短时间旧数据；
5. 深页 OFFSET 在数据增长后可能恶化；
6. 没有真实 P50/P95/P99 报告，无法确认 10,000 SKU 和 50 用户并发下的体验；
7. 图片下载缓存策略还不是统一 immutable CDN 方案；
8. 当前详情缓存没有 Redis 实现，不能假设缓存命中会降低详情 P95。

### 可回滚性

- 列表保留 Summary 路径，ProductRecord 直读评估可独立灰度；
- Redis 未接入商品读路径，不存在 Redis 回滚阻断；
- 投影可通过 Outbox 重试和 repair 重建；
- ProductRecord 不依赖缓存或投影才能恢复。

## 14. 最终架构图

```text
                         ProductRecord
                       Core Source of Truth
                              │
             ┌────────────────┼────────────────┐
             │                │                │
             ▼                ▼                ▼
        Product API        Product Outbox    Storage/FileObject
             │                │                │
             │                ▼                │
             │             Worker             │
             │                │                │
             │      Summary/Text/Product      │
             │      Center projections        │
             │                │                │
             ├────────────────┴────────────────┤
             │                                 │
             ▼                                 ▼
      PostgreSQL primary                 Optional Cache
      data and read models            Map / PG / future Redis
             │                                 │
             └────────────────┬────────────────┘
                              ▼
                              UI
                    Pagination + Virtual Rows
                              │
                       Lazy Thumbnail
                              │
                    Detail On-Demand API
```

图片链路：

```text
Storage original
  -> 160px WebP thumbnail
  -> FileObject metadata
  -> ProductRecord asset reference
  -> ProductMedia / Summary derived index
  -> list thumbnail
  -> detail original when requested
```

## 15. Production Closeout 结论

### 当前已达到

- 商品核心资料有明确 Source of Truth；
- 商品保存具备 revision、事务、审计和 Outbox；
- 列表不是全量加载；
- 列表使用数据库过滤、排序和分页；
- 列表不读取完整 payload；
- 列表有虚拟行和缩略图懒加载；
- 详情有统一 Detail Service；
- 投影和缓存不可用时存在降级或恢复路径；
- Redis 没有被错误地当成商品事实源或图片存储。
- 商品列表搜索已覆盖关键词，且筛选 total 与列表 SQL 使用同一套条件；
- Worker 健康接口已能观察商品 Outbox、投影状态和 ProductRecord/读模型版本漂移。
- 旧 revision 的投影失败状态不会污染当前 revision 的详情状态。

### 当前未达到

- 尚未完成 1k/5k/10k SKU benchmark；
- 尚未完成 P50/P95/P99 的 API、SQL、浏览器和图片指标；
- 尚未证明 ProductSummaryRecord 是否必须长期作为列表主读模型；
- 尚未证明 Redis 商品详情缓存能带来实际收益；
- 尚未完成重复图片引用和媒体索引的长期收口；
- 深分页和 50 用户并发场景仍需实测。

### 最终结论

**NOT PRODUCTION READY**

这里的 `NOT PRODUCTION READY` 仅表示“Product Center 性能优化与架构收口尚未完成最终证据闭环”，不表示当前商品功能不能使用，也不表示必须立即重写。完成 benchmark、修复被证明的瓶颈、补齐剩余一致性审计后，再重新评估是否达到 `PRODUCTION READY`。
