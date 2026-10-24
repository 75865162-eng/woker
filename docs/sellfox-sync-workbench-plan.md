# 赛狐只读同步与数据浏览器实施方案

状态：本地实现完成，等待环境部署和真实接口验收。永久保留：系统不按时间自动删除快照。

## 现状与边界

- 复用 `src/lib/sellfox/client.ts` 的 token 缓存、HMAC 与 token/40019 重试，不新增 HTTP 客户端。
- 当前 POST sync 在请求内执行，stores 只请求第一页；hourly 每店仅采样前五个 SP campaign；performance 已分页，但缺持久化 checkpoint。
- 当前权限为 `sellfox:view` 和 `sellfox:create`，继续沿用，API 必须校验组织和 workspace。
- 已有 BullMQ、Redis queue、WorkerHeartbeat 及 Amazon schedule 模式，可复用机制但独立赛狐队列与资源，避免串入 Amazon 任务。
- ProductRecord 不变；赛狐新数据仅为报表快照。凭据仅从服务端环境读取，API 仅暴露 configured。

## 实施顺序

1. 建立稳定资源集合 stores/performance/hourly/inventory/sales/listings/ads_report；抽离 sync 服务，保留既有接口参数兼容。
2. 新增库存、销量、Listing 快照与 schedule；扩展 SyncRun 的任务参数、checkpoint、租约/更新时间和幂等标识。只做增量 migration，不改商品主档。
3. 分页同步按店运行。页内快照提交后再推进 checkpoint；重放当前页由唯一键 upsert 去重。单店失败记录在 summary 后继续后续店，整体有失败不得标为全部成功。
4. 独立串行 Sellfox Worker；手动和定时都先写持久化 run，再由同一服务执行。Worker 恢复未完成任务并写 heartbeat。定时启用须有明确 workspace 和有效有权限的执行身份。
5. 增加分页域 API、CSV 和 overview 健康度，重构页面为连接栏、域导航、表格、详情与运行日志。
6. 完成无外网测试、类型/lint、Prisma generate/validate 与 migration 静态检查，记录浏览器验收步骤。

## 队列与限流

- 单一执行入口，任务包含 organizationId、workspaceId、resource、shopExternalIds、reportDate/dateRange 与 runId。
- 空 shopExternalIds 对数据域表示当前 workspace 已同步店铺；指定店铺必须验证归属。
- 所有实际外部请求（包括 token、重试和分页）起始间隔至少 1200ms，前一请求结束后再执行下一请求。
- 仅进程内 Promise 队列不足以限制 web/Worker 多进程。手动 API 不直接调用赛狐，Worker 需有全局执行所有权/锁，避免多副本同时执行；既有脚本调用 client 的路径也要纳入盘点。
- 40019、token 和可恢复网络错误指数退避；错误输出使用脱敏固定信息/错误码，不保存原始 URL、token、secret 或不受控上游 msg。
- 请求数据落库后更新 checkpoint。崩溃恢复重放当前页；禁止仅靠 fire-and-forget API 保活。

## 存储与幂等

- 店铺继续使用 organizationId + workspaceId + externalId 唯一键。
- 新快照具备 organizationId/workspaceId/storeId、业务日、稳定 sourceKey、ASIN/MSKU/SKU、syncedAt 与 payload。
- 库存每次抓取生成独立快照（同一 run 重试复用 capturedAt 幂等），以业务日筛选；销量采用店铺 + 报表日 + 业务键，重复同步更新同一业务日记录。
- Sellfox 店铺存在任一快照时数据库拒绝删除店铺行，避免外键级联删除历史；当前没有自动过期、清理或删除快照的入口。备份与存储容量仍由数据库运维策略负责。
- 业务键必须依据接口实际粒度确定，库存还需核对 FNSKU/库存状态等维度，禁止以标题当键或猜测字段把不同记录合并。
- 数量缺失保留 null，不伪造零；响应结构或店铺归属无法确认时失败并留下 run，不标空数据成功。
- 列表默认 50 行，服务端过滤分页；列表不默认返回完整 raw payload，详情按需读取。
- CSV 复用现有导出格式与范围，防电子表格公式注入并限制导出规模；保持组织/workspace 权限。

## 定时策略

- stores 每 8 小时；inventory 每 3 小时；listings 每日一次。
- sales/performance 每日 Asia/Shanghai 06:30 拉 T-1；近七日补缺需有明确的完整性判断。
- hourly 默认关闭，明确标浅同步；ads_report 占位禁用。
- 默认不自动为所有租户启动外部请求。计划按 workspace 持久化启用，展示下一运行时间、最近运行和失败状态；执行前复核执行人权限。

## 页面/API

- 顶栏 configured、workspace、店铺多选、立即同步资源菜单、最近运行与各域上次成功时间。
- 域：overview/stores/inventory/sales/performance/listings/ads/runs。
- URL 保存域、店铺、日期范围、搜索、站点、页码；切换 workspace 清空旧数据并取消/忽略迟到响应。
- 沿用现有 overview/performance/export，新增各域列表及导出；POST sync 对长任务返回 202 + runId，通过 runs 轮询。
- 读沿用 sellfox:view，同步沿用 sellfox:create，不扩宽角色权限。
- 无凭据提供服务器配置说明链接，无店铺引导同步店铺，无库存引导同步库存。

## 外部接口待核验

- stores：`/api/shop/pageList.json`；performance：`/api/sale/profit/product/pageList.json`。
- inventory：核对 `/api/inventoryManage/fba/pageList.json` 的请求筛选、分页、返回字段及粒度。
- sales：实现使用用户提供的候选 `/api/productSale/page.json`；上线前仍须通过当前赛狐账号对应文档核对精确路径、请求筛选名和逐日字段语义。区间响应若缺逐日日期会停止该店写入并让 run 失败，不把区间结果伪装成单日数据。
- listings：核对在线产品 V2 的精确路径、分页与稳定身份字段。
- 尚未核验的接口不得猜测实现并标记可用；必要时以明确未接入状态交付，记录所缺契约。

## 本地实现状态

- 已实现 PostgreSQL 全局 advisory lock + client Promise queue；每次 token/API HTTP 请求完成后至少间隔 1200ms，跨 Worker 进程共享同一数据库锁。
- 已实现独立 BullMQ 队列、concurrency 1 Worker、heartbeat、持久化 run/checkpoint、指数退避重试、组织/workspace/shop 验证和权限撤销后暂停计划。
- 已实现 stores、inventory、sales、performance、既有 hourly 浅同步；inventory/sales/performance 按 store/page 保存 checkpoint，重试从最近完成页继续。快照不自动过期，且店铺删除受历史快照外键保护。
- 已实现 stores/inventory/sales/performance/hourly/runs 的服务端分页、域筛选、CSV 与 `/sellfox` 域导航、日期/店铺/ASIN/MSKU/SKU 搜索、详情摘要和定时开关。
- Listing 和 ads_report 保持灰态占位；当前广告视图是既有 SP 小时浅同步结果。
- 本机 `.env` 未修改，未执行数据库迁移，未安装/启动生产 systemd unit，未访问真实赛狐接口。

## 影响、回滚与验证

- 影响仅限赛狐 API/UI、增量 Prisma 表、独立队列/Worker 命令与运维说明，不变更 ProductRecord 或 Amazon transport。
- 1200ms 串行意味着 100 页请求至少约两分钟，实际还包含上游响应和数据库时间。异步排队避免拖慢页面请求；独立 Worker 避免阻塞现有导入队列。
- 数据库增加快照和索引存储；不默认全历史补拉，不在页面执行同步或重计算。长期保留/清理政策在有真实规模后另定。
- 回滚先关闭赛狐计划并停止独立 Worker，再回退应用；增量表保留，不执行 down migration，不删除报表记录。
- 当前新增测试只覆盖请求串行/1200ms 间隔、资源与日期校验及分页边界；同步服务落库幂等、路由权限和页面交互尚无专门自动化覆盖。不访问真实赛狐。
- 按用户要求优先相关测试 + lint/typecheck，必要时 check:fast；Prisma generate/validate 和 migration 检查。不默认全量 build/E2E，也不迁移生产。
- 生产安装需审核后安装 `deploy/systemd/amazon-sellfox-sync-worker.service`，并确认 `QUEUE_DRIVER=redis`、Redis、PostgreSQL 及服务端 Sellfox 凭据；再按受控流程审阅并部署迁移。销售候选接口 `/api/productSale/page.json` 的官方路径、字段及口径尚未核验；当前网络无法访问官方文档，必须先用赛狐账号对应文档核实，再进行真实接口验收。全仓 `check:fast` 曾被既存未跟踪 `tmp/create-kayak-sku.ts` 的 `no-explicit-any` 阻断，赛狐定向 lint、类型检查和已有测试通过。
- 本次未改服务器 `.env`、未部署/启动生产 Worker、未访问真实赛狐。现有工作区包含大量其他模块未提交改动，GitHub 同步须先确认整体范围。
