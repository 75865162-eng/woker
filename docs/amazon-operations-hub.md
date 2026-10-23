# Amazon 经营中台（内部 ERP）

入口 `/operations?tab=overview`，沿用登录、组织与工作区权限。Amazon 凭证仅在服务端，所有同步只读，不写 `ProductRecord`，不写回 Amazon。

## 页面与数据范围

| Tab | 内容 |
|---|---|
| overview | 当前工作区/站点、六域状态、真实库存摘要、最近失败 |
| sync | 计划间隔/开关/下一次时间、立即同步库存、最近 20 次运行 |
| inventory | 最新成功库存快照，可售/在途/预留/不可售、SKU 搜索、分页 |
| ads | 现有 PPC 来源说明、日指标缺失状态、跳转 `/workspace` 查看出价/预算/花费/ACOS |
| orders | NOT_SYNCED，占位并说明计划频率及 Pending 口径尚未接通 |
| catalog | NOT_SYNCED；Amazon Listing 快照，非公司商品主数据 |
| runs | 最近 20 次运行按域/状态/起始日期筛选，summary/error/耗时/条数详情 |

六域中只有 inventory 已有 Amazon 执行器。ads 标记来自现有 PPC；目前 `WorkspaceDataset.performanceRows` 缺少可靠的日粒度 SKU/ASIN 关联，不能把上传日期当作报告日期。因此日指标返回 `NOT_SYNCED`、空行及 null 字段说明，广告指标继续在现有 PPC 工作台查看。订单、目录、财务、履约均未实现，手动请求会 BLOCKED，意外进入 worker 会 FAILED，不能伪造成功。库存数量是最新成功快照而非今日累计数。

库存新鲜度由 `AMAZON_INVENTORY_FRESHNESS_MINUTES` 控制，默认 360 分钟，允许 15–1440。STALE 会显示原因及检查连接/worker 后重新同步的建议；最新尝试失败与旧快照新鲜度分开保留。六域 summary 提供 `lastSuccessAt`、`nextScheduledAt`、最近尝试及失败原因。

## 定时与手动同步

新增 `AmazonSyncSchedule` 按 `organizationId + workspaceId + resource` 唯一。保存 intervalMinutes、enabled、lastEnqueuedAt、修改者及时间。全部默认关闭，只有库存可以启用；广告不另建同步。建议间隔如下：

| 域 | 默认分钟 | 当前可启用 |
|---|---:|---|
| inventory | 60（后续可调 15–30） | 是 |
| orders | 15（接通后可调 15–30） | 否 |
| ads | 120（PPC 投影预留） | 否，sourced_from_ppc |
| catalog / finance / fulfillment | 1440 | 否 |

间隔可配置为 15–10080 的整数分钟。启用或修改计划后等待一个完整间隔首次执行；修改会重置计时。停用立即阻止后续入队，不取消已排队/运行任务。计划不补齐停机期间所有历史时点，只产生一次到期运行；订单历史窗口留待订单执行器实现。

`npm run worker:amazon-sync` 每 30 秒检查到期计划，调度器仅在数据库建立 `AmazonSyncRun`，随后现有队列恢复逻辑入队，真正拉数仍由 `processAmazonSyncRun` 执行。多实例调度采用事务 advisory lock、到期时间幂等键及重新读取计划。手动/定时入队共享 org/workspace/resource 锁，已有 QUEUED/RUNNING 时复用或跳过；执行器再以 PostgreSQL session advisory lock 跨 HTTP 请求串行化相同作用域，进程崩溃后连接断开即释放锁。锁占用时不宣告同步成功，仍保留 QUEUED，下一次恢复再派发。已完成 BullMQ job 自动移除以允许这个恢复路径；真实结果由数据库 SyncRun 保存。

专用 worker 并发默认 1、最大 2；每个在运行任务额外使用一条 PostgreSQL 锁连接。调度检查有界每轮 100 个计划，待入队恢复每轮 50 条；当前面向内部少量工作区。扩展到大量计划前应补数据库到期索引/游标与负载测试。失败最多 3 次指数退避。超过 15 分钟的 RUNNING 只有在取得同一执行锁（原任务已不运行）后才终止为 FAILED，并清理半成品，供人工重新同步；不会重新启动仍活跃的 HTTP 任务。

Amazon 限流、广告归因延迟与库存快照短暂差异应按页面提示理解。页面仅查库，手动按钮只负责 enqueue。

## API 与权限

全部接口沿用 session 组织与 workspace scope；不接收浏览器提供的组织覆盖，不返回凭证。

- `GET /api/operations/freshness`：`operations:view`，六域/连接/库存/最近 20 次运行，no-store。
- `GET /api/operations/readiness`：兼容旧入口，同样按作用域查询。
- `GET /api/operations/inventory/snapshots?page=1&pageSize=50&sku=SKU-1`：`operations:view`，最新成功运行，页大小上限 200。
- `GET /api/operations/metrics/daily?from=YYYY-MM-DD&to=YYYY-MM-DD&sku=SKU&asin=ASIN`：`operations:view`，最多 90 天；当前日投影未接通，返回空行与 null 原因，不以其它报表冒充 PPC。
- `GET /api/operations/schedules`：`operations:view`，返回六域默认/持久计划及 canEdit。
- `PATCH /api/operations/schedules`：`operations:edit`，body `{ "resource": "inventory", "intervalMinutes": 60, "enabled": true }`；其它域不能启用。
- `POST /api/operations/sync-runs`：`operations:create`，body resource + idempotencyKey；QUEUED 为 202，BLOCKED 为 409。只读用户是否可手动触发由既有 create 权限决定。

内部 Agent 只读接口留在上述查询面；没有公开 MCP/CLI。`AmazonAgentActionAudit` 仅预留 preview/confirm/idempotency/old/new，没有真实 Amazon 写入口。

## 环境与启动

需审核应用相关 Prisma migrations 后，在受控环境按既有迁移流程应用；本轮代码修改没有执行 migrate、生产部署或改写环境文件。新增计划表为追加结构，回退应用保留表即可；先停用计划再停 worker。不会自动回滚数据库。

服务端环境：DATABASE_URL、QUEUE_DRIVER=redis、REDIS_URL，以及 `AMAZON_SP_API_LWA_CLIENT_ID`、`AMAZON_SP_API_LWA_CLIENT_SECRET`、`AMAZON_SP_API_REFRESH_TOKEN`、`AMAZON_SP_API_AWS_ACCESS_KEY_ID`、`AMAZON_SP_API_AWS_SECRET_ACCESS_KEY`。可选 AWS_SESSION_TOKEN/AWS_REGION/ENDPOINT。必须以 `AMAZON_SP_API_ALLOWED_ORGANIZATION_ID` 和 `AMAZON_SP_API_ALLOWED_WORKSPACE_ID` 精确绑定授权作用域。不要在浏览器填写密钥。

```bash
npm run worker:amazon-sync
```

先在对应工作区完成 Marketplace Participations 连接校验，站点须唯一匹配真实 Marketplace ID。连接未验证时计划运行会记录 FAILED，可追踪错误；不得为了演示配置假数据。

## 验收

1. 授权账号访问七个 Tab，六域状态与工作区/站点正确；无权 API 返回 403（未登录 401）。
2. 配置受控测试 Amazon、Redis、数据库；连接校验后手动库存同步，检查快照/分页/SKU，失败清除该 run 半成品。
3. 启用库存 15 分钟测试间隔，等待到期加最多约 30 秒；观察自动 SyncRun、lastEnqueuedAt、nextScheduledAt 与成功/失败。关闭计划后确认不再产生新任务。
4. 在到期附近手动同步、并开两个 worker 验证同域无双跑；中止 worker 后验证锁释放与失败恢复。已排队任务不因停用计划取消。
5. 切 workspace 后状态及表格不残留旧数据；数据库查询均保持 organization/workspace 过滤，浏览器 Network 无 Amazon token/secret。
6. Ads 明确日投影未接，PPC 深链可用；订单/目录灰态明确，不把 null 显示为销量 0。

自动回归：`npx tsx --test tests/operations*.test.ts tests/amazon*.test.ts`、`npm run lint`、`npm run typecheck`、`npm run build`。数据库锁与调度测试含模拟连接；真实 PostgreSQL/Redis 多进程、权限账号及 Amazon 验收须在受控环境补跑。
