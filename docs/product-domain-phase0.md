# 商品域阶段 0：架构止血

## 目标

本阶段只稳定商品域的数据边界和一致性，不增加商品业务功能。

选定的投影策略：

```text
ProductRecord
  = Source of Truth
        |
        +-- ProductProjectionRequested Outbox
                  |
                  v
             Projection Worker
                  |
        +---------+----------+
        |                    |
ProductSummary          ProductText
        |
ProductListSummaryRecord
```

主记录和 Outbox 事件在同一个 PostgreSQL 事务中提交。投影失败只影响读模型，不回滚或删除主记录；Worker 按最新 `ProductRecord.revision` 幂等重建投影。

## 商品域路径清理约定

当前商品主数据只允许走以下闭环：

```text
ProductRecord
  -> PostgreSQL transaction
  -> ProductOutboxEvent
  -> Projection Worker
  -> ProductSummaryRecord / ProductTextRecord / Product Center
  -> Product API
  -> Product UI
```

以下旧商品资料路径已废弃，后续不得恢复为备用读写路径：

- `SellfoxProductRecord` 及其在线商品同步、列表读取和转换逻辑。
- `/api/sellfox/products` 及 Sellfox 工作台中的在线商品列表。
- `ProductImageCopyGalleryRecord`、`/api/products/:sku/image-copy-gallery` 及其独立图片文案草稿 UI。
- ProductRecord 中用于识别旧 Sellfox 商品资料的兼容判断和回填逻辑。

旧商品资料清理时，必须同时检查代码引用、Prisma model、migration、API、前端入口、脚本、测试和文档，不能只删除其中一层。当前数据库已确认没有旧 Sellfox 商品记录、旧图片文案草稿记录，也没有 `source = 'sellfox'` 的 ProductRecord。

以下 Sellfox 数据不属于商品主资料，不随旧商品路径删除：

- `SellfoxStore`
- `SellfoxHourlyMetric`
- `SellfoxProductDailySnapshot`
- `SellfoxSyncRun`
- Sellfox 店铺同步和产品表现报表接口

## 1. 字段归属表

### ProductRecord：事实源

| 字段 | 归属 | 说明 |
| --- | --- | --- |
| `id` | ProductRecord | 商品稳定主键 |
| `organizationId` | ProductRecord | 组织租户边界 |
| `workspaceId` | ProductRecord | 工作区边界 |
| `userId` | ProductRecord | 最近一次写入用户 |
| `accountId` | ProductRecord | 销售账号上下文 |
| `marketplace` | ProductRecord | 站点上下文 |
| `sku` | ProductRecord | 工作区内商品业务唯一标识 |
| `payload` | ProductRecord | 完整商品快照、原始/不稳定字段、扩展字段 |
| `revision` | ProductRecord | 乐观锁和投影版本依据 |
| `createdAt` / `updatedAt` | ProductRecord | 事实源时间 |

### ProductSummaryRecord：列表读模型

只保存列表展示、筛选、排序、搜索和看板首屏需要的字段：

`productRecordId`, `organizationId`, `workspaceId`, `accountId`, `marketplace`, `sku`, `asin`, `chineseName`, `englishName`, `source`, `primaryImageUrl`, `status`, `supplierName`, `purchasePrice`, `selectionOwner`, `opsAssignee`, `designerAssignee`, `currentOwner`, `workflowStage`, `workflowDueAt`, `isOverdue`, `operationsProgressIncomplete`, `sourceRevision`, `projectionVersion`, `sourceUpdatedAt`

禁止放入完整 JSON、竞品数组、长描述、图片数组、视频策划和工作流历史。

### ProductTextRecord：文本读模型

保存 `developer`, `supplierUrl`, `specs`, `purchaseLeadTime`, `keywords`, `note`, `cancelReason`, `hsCode` 以及语言、来源 revision 和 projection version。

商品标题字段目前仍由 Summary 持有，因为列表展示和搜索需要；多语言 Listing 内容后续再单独建模。

## 2. Source of Truth 清单

| 数据 | 唯一事实源 | 派生读模型 |
| --- | --- | --- |
| 商品完整资料 | `ProductRecord.payload` | `ProductSummaryRecord` / `ProductTextRecord` |
| 商品版本 | `ProductRecord.revision` | `sourceRevision` |
| 商品列表计数 | `ProductSummaryRecord` | `ProductListSummaryRecord` |
| 商品图片二进制 | `FileObject` / storage adapter | `ProductRecord.payload.imageAssets` 中的引用 |
| 视频策划 | 当前阶段 `ProductRecord.payload.videoPlan` | 详情 DTO |
| 商品审计版本 | `DataChangeVersion` | 无 |

业务 API 不得把 Summary/Text 当成第二个可编辑事实源。

## 3. Projection 清单

| 投影 | 来源 | 触发方式 | 失败处理 |
| --- | --- | --- | --- |
| `ProductSummaryRecord` | `ProductRecord` | 保存事务写 Outbox，Worker 执行 | Outbox 重试，必要时人工 repair |
| `ProductTextRecord` | `ProductRecord` | 保存事务写 Outbox，Worker 执行 | Outbox 重试，必要时人工 repair |
| `ProductListSummaryRecord` | `ProductSummaryRecord` | Summary 投影完成后重建 | 重新按 Summary 聚合 |
| 列表缓存 | Summary / list summary | 投影完成后失效 | 缓存 miss 后重新读取 |

Worker 始终读取当前 `ProductRecord`，而不是信任事件 payload 中的完整商品 JSON。因此旧事件晚到不会覆盖新 revision。

## 4. 状态枚举与非法状态扫描

当前 ProductRecord 合法状态：

```text
pending
developing
ops_review
design_in_progress
listing_confirming
listed
canceled
delisted
patent_risk
```

只读扫描命令：

```bash
npm run products:scan-statuses
```

约定：

- 退出码 `0`：没有非法状态；
- 退出码 `2`：发现非法状态，输出最多 100 条样本；
- 退出码 `1`：数据库或脚本执行失败；
- 阶段 0 不自动把非法值改为 `pending`，避免静默改变业务含义。

`operations_progress`、`development_phase`、`overdue` 是列表筛选派生条件，不是 ProductRecord.status 值。

## 5. 商品 API 租户和 workspace 边界

所有商品 API 必须满足：

1. 先通过 `requireApiPermission("products", action, request)`；
2. 组织边界来自当前登录用户的 `organizationId`，不能由请求体覆盖；
3. workspace/account/marketplace 通过 `workspaceScopeFromRequest` 归一化；
4. 商品主记录查询必须使用 `organizationId + workspaceId + sku` 或商品 `id + organizationId + workspaceId`；
5. 文件和附件查询必须同时校验 `organizationId + workspaceId`；
6. 不允许只按 SKU、文件 ID 或裸商品 ID 查询后直接返回。

当前接口覆盖：

| 接口 | 权限 |
| --- | --- |
| `/api/products` | view / edit |
| `/api/products/:sku` | view |
| `/api/products/:sku/detail` | view |
| `/api/products/:sku/video-plan` | view / edit |
| `/api/products/export` | export |
| 图片、附件、结论文件、视频素材接口 | view / edit |

## 6. 详情投影缺失降级策略

详情 404 只表示 `ProductRecord` 在当前组织和 workspace 不存在。

如果 Summary/Text 缺失或 `sourceRevision !== ProductRecord.revision`：

- 仍返回商品详情；
- `projection.status = "pending"`；
- `summary` 或 `text` 可以为 `null`；
- 文本读模型未就绪时，详情暂时保留 `ProductRecord.payload` 中的原始文本；
- 响应使用 `Cache-Control: no-store`；
- Outbox Worker 或 repair 命令完成后，下一次读取自动变为 `ready`。

## 7. 一致性和补偿

保存流程：

```text
请求
  -> ProductRecordRepository
  -> ProductRecord.revision + 1
  -> ProductProjectionRequested Outbox
  -> 同一事务提交
  -> 返回主记录
  -> enqueue Worker
  -> 重建 Summary/Text/ListSummary
```

投影失败不会丢失主记录。Outbox 具备状态、attempts、availableAt、lastError 和 stale recovery。

历史数据补投影：

```bash
npm run products:repair-projections
```

该命令按批次读取 ProductRecord，幂等 upsert Summary/Text，再重建各 workspace 的列表汇总。

## 阶段 0 验收标准

- 主记录与 ProjectionRequested Outbox 原子提交；
- 投影失败时 ProductRecord 仍可读取；
- 详情不会因为投影缺失返回 404；
- 商品列表正常读取 Summary 列，投影缺失或 revision 未追平时可从 ProductRecord 读取列表所需的最小图片/文本兜底字段，不向浏览器发送完整 payload；
- 详情由 `ProductDetailService` 统一聚合；
- 历史 ProductRecord 可通过 repair 命令补投影；
- 非法状态可扫描、可统计、不会被静默覆盖；
- 所有商品 API 有组织和 workspace 权限边界。

## 7. 本轮重大重构收口

### ProductRecord 临时聚合根

当前商品域明确采用 `ProductRecord` 作为临时聚合根，而不是让 API route 直接写多张商品表。它负责在一次数据库事务中协调：

```text
ProductRecord
  + ProductAttachmentBinding
  + ProductProjectionRequested Outbox
  + DataChangeVersion / AuditLog
  + ProductSaved / ProductRestored Outbox
```

`ProductSummaryRecord`、`ProductTextRecord` 只能由 Projection 写入，禁止业务接口单独维护。

### Projection 状态和失败记录

新增：

- `ProductProjectionState`：每个商品、每种投影的当前状态；
- `ProductProjectionFailure`：每次投影失败的历史记录。

投影状态包括 `pending`、`processing`、`ready`、`failed`，并保存 source revision、projection version、attempts、错误、开始时间、完成时间和下一次重试时间。Outbox 仍然负责调度和重试，状态表负责可观测性。

### Revision 防旧数据覆盖

Summary/Text 写入使用数据库条件更新：

```text
incoming sourceRevision >= existing sourceRevision
```

旧 revision 事件只返回幂等跳过，不得覆盖新读模型。Worker 始终读取当前 ProductRecord，因此晚到的旧 Outbox 事件也不会把新商品倒退。

### 投影重建

```bash
npm run products:repair-projections
```

该任务按批次读取 ProductRecord，重建 Summary/Text，刷新 ProductListSummary，并同步更新投影状态。任务可重复执行，不依赖旧 payload fallback。

### 商品状态机

状态迁移在 `ProductRecordRepository` 保存前服务端强制校验。非法状态或非法迁移返回 `400`，不会依赖前端下拉框约束。列表筛选值 `overdue`、`operations_progress`、`development_phase` 仍然是派生筛选，不属于商品状态。

### ProductDetailDTO

详情统一由 `ProductDetailService` 返回：

```text
product
summary
text
workflow
media
metrics
projection
```

`metrics` 当前保留为 `null` 扩展位，后续接入 ProductMetrics 时不需要改变详情接口整体结构。所有数据库时间字段在 DTO 中统一转换为 ISO 字符串。

### 事务边界

商品保存、视频策划保存和版本恢复均复用 `saveProductAggregate`。主记录、附件绑定、审计版本、审计日志和 Outbox 在一个 PostgreSQL 事务中提交，确保快速连续保存时不会丢中间版本。通知不直接放进数据库事务，而是通过同一事务写入的 Outbox 异步处理，失败可以重试且不会丢主记录。

本轮已删除 Sellfox 商品主资料和独立图片文案 Gallery，不提供旧数据降级回退。部署
`20260914000000_remove_legacy_product_paths` migration 时会删除旧表、删除旧
`ProductRecord` 标记和 Sellfox summary 分桶；Sellfox 报表表继续保留。

## 9. 发布准入与版本恢复约束

商品域数据库迁移完成后，不能只以 Prisma migration 成功作为准入条件。预发或生产发布必须按以下顺序执行：

```bash
npm run products:scan-statuses
npm run products:repair-projections
npm run products:scan-statuses
```

第一步确认事实源没有非法状态；第二步补齐历史商品的 Summary、Text、Product Center 投影和列表汇总；第三步确认修复过程没有引入新的非法状态。`products:repair-projections` 会写入投影和投影状态，不应在普通应用启动时自动执行。

版本恢复规则：

- 恢复始终使用历史版本保存时的 `workspaceId`、`accountId` 和 `marketplace`，请求体不能把版本恢复到另一个工作区。
- 恢复是显式的审计操作，可以恢复到历史的合法商品状态，即使该状态不符合普通编辑流程的前进方向。
- 恢复仍然需要当前商品的 `revision`，并发变化时返回 `409`，不能静默覆盖。
- 恢复后的新版本、审计日志、投影事件和附件绑定必须与普通保存一样进入同一个事务。
- 恢复目标状态必须属于产品状态目录；非法历史状态不能直接恢复，应先人工处理或建立专门的数据修复流程。

## 8. 商品中心规范化模型

本轮开始从“商品 JSON”升级为商品中心。规范化模型由 `ProductRecord` 投影生成，不允许业务接口绕过聚合保存直接分别写入：

```text
Marketplace
  └─ SellerAccount

ProductMaster
  ├─ ProductVariant
  ├─ ProductListing
  ├─ ProductSupplier ── Supplier
  ├─ ProductCost
  └─ ProductMedia ── FileObject
```

实体职责：

- `ProductMaster`：商品主数据和跨站点共享身份，当前以 `ProductRecord` 一对一作为过渡关联。
- `ProductVariant`：SKU、ASIN、规格属性和重量尺寸。当前每个 ProductRecord 先生成一个默认 variant，为后续多变体扩展保留结构。
- `ProductListing`：某商品/变体在某销售账号和站点上的刊登上下文，不能把 Listing 状态混进商品主状态。
- `Marketplace`：站点字典，例如 US、CA、UK；属于组织级主数据。
- `SellerAccount`：销售账号与站点的组合上下文，按组织、workspace、账号和站点唯一。
- `Supplier`：组织级供应商主数据，使用规范化名称去重。
- `ProductSupplier`：商品与供应商的关系，保存供应商 SKU、链接、采购周期、MOQ 和主供应商标记。
- `ProductCost`：成本事实，当前写入采购成本，后续可扩展运费、包装、关税、仓储和广告成本。
- `ProductMedia`：商品媒体索引，关联 `FileObject`，保存媒体类型、角色、排序和访问 URL；占位图片只保存 URL，不伪造文件外键。

数据流：

```text
ProductRecord
   ↓ product_center projection
ProductMaster / Variant / Listing / Supplier / Cost / Media
```

当前商品中心表均预留 `sourceRevision` 和 `sourceUpdatedAt`。旧 revision 不得覆盖新规范化数据；投影失败由 `ProductProjectionState` 和 `ProductProjectionFailure` 记录，主记录不回滚。
