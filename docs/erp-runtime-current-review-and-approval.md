# ERP 运行环境统一：当前复核与剩余审批范围

本次复核基于当前未提交工作区，不代表 GitHub 或服务器已同步。运行态采样工具时间为 `2026-11-06T16:24:17Z` 至 `2026-11-06T16:25:05Z`；保留 UTC 原始观察时间，避免本机时区解释差异。本文不授予任何执行权限。

## 本次确认

- 工作区已有 160 个修改/未跟踪路径，包括本任务相关 runtime、schema、服务单元，以及 Amazon/Sellfox 其他业务改动。未覆盖、撤销、暂存或提交任何已有改动。
- 本地根 `.env` 当前指向 PostgreSQL `127.0.0.1:55439/amazon_sync_live_local`、Redis `127.0.0.1:6399/0`，队列模式为 redis。只读数据库身份查询确认库名；网页和四个 Worker 的实际 TCP 连接均指向上述端口。网页监听 loopback 3017。
- 四类注册为 import（含 Product Outbox）、image-upscale、amazon-sync（含 SP-API/Ads）、sellfox-sync。存在一个 manager 和四个 child；未发现本仓库其他旧 Worker 入口进程。
- 四条数据库心跳在最后一次采样时均距数据库 UTC 时钟约 18 秒，status=online、queueReady=true。开发版本标记均为 development，不能据此证明源码修改后进程已加载最新代码。
- 心跳字段是 PostgreSQL timestamp without time zone；本次以数据库 UTC 时钟计算年龄，未采用 node-pg 对无时区字段的本机时区解释。
- 历史 `.env.amazon-live.local` 仍存在。共享变量逐值一致；仅旧文件有 DOTENV_CONFIG_PATH/NODE_ENV。runtime 已拒绝临时 profile，不读取该文件。未删除文件或展示凭据。
- 现有 Amazon 任务有实际运行中记录，34 条计划启用；Sellfox 有两条 failed 记录。启动/重启消费者会触发已有业务工作，不能作为无副作用测试。

## 复用现有边界

- `scripts/runtime/environment.mjs` 为 web/standalone/注册 Worker 共用加载器：本地根 `.env`，生产注入变量，拒绝冲突、额外 Next env、本地非 loopback 目标及非 Redis 模式。loopback 仍不能单独排除隧道或代理。
- `scripts/runtime/worker-manager.mjs` 已有启动/停止/退避；child 已有同目标锁及父进程 IPC 生命周期约束。无需新建第二套 supervisor。
- `src/lib/runtime/job-execution.ts` 已有导入/图片 token、租约、有界恢复与事务发布校验。Amazon/Sellfox 沿各自已有任务、游标和恢复实现；不另建通用业务任务事实源。
- PostgreSQL 继续存业务意图/状态/心跳，Redis 只承载队列。ProductRecord、Storage adapter 和组织/工作区/店铺权限边界保持原实现。
- systemd、release 切换及备份脚本已存在，尚未在本轮检查或更改服务器运行态。

## 明确缺口

1. `scripts/amazon-sync-live-preflight.mjs` CLI 仍有 dotenv + DOTENV_CONFIG_PATH 入口，与统一加载器不一致；Prisma CLI 和部分维护脚本也有独立配置入口，需按入口逐项核对，不能声称全部 CLI 已统一。
2. `src/app/api/listing-ai/optimize/route.ts` 当前直接 await optimizeListing。注册的 AI 图片 Worker 不等于 Listing AI 已后台化。把 Listing AI 迁入持久化任务涉及 API、UI 状态、任务表、费用与重试语义，需独立具体方案。
3. `deploy/backup/` 每日定时器只是草案；没有本轮正式启用证据。数据库 dump 不涵盖 uploads/R2 对象或独立加密密钥。旧记录的每日/30天偏好不是本轮删除授权。
4. 当前恢复测试仍缺重计算中 OS kill、导入文件/导出/审计发布专属故障注入。现有隔离通过记录不能代替这些断言。
5. 生产部署、开机自启及重启恢复没有本次实际验收；本地 development 心跳也无法精确识别工作区代码版本。

## 建议批准 A：最小代码收口与隔离验证

批准范围仅为以下代码、测试和文档；不操作真实配置、任务、进程或服务器：

- 修改 `scripts/amazon-sync-live-preflight.mjs` CLI 复用 runtime loader，保留其纯 inspect 函数及脱敏输出；更新 `tests/amazon-sync-preflight.test.mjs` 和相关 runtime 测试，覆盖替代配置拒绝及生产/本地边界。Prisma/维护 CLI 先形成入口清单，再只对确需统一的入口提交精确 diff，不直接扩大修改。
- 在现有 `tests/integration/runtime-execution.integration.ts`、`scripts/test-runtime-integration.mjs` 中补充缺失故障注入；仅新建的 mock PostgreSQL/Redis/文件/进程可重启、强杀、清空和清理。复用现有执行租约，不新增任务框架。若测试暴露业务实现缺陷，再给出对应修复 diff/影响范围。
- 给出 Listing AI 后台化独立设计及可审阅 schema/API 草案，盘点当前调用方和兼容路径；本阶段不更改正式 API 或执行 migration。付费调用遇到未知结果不自动重放，provider 幂等能力未经确认不承诺 exactly-once。
- 同步本运行说明及验收表，区分历史证据、本次结果和未完成项。

影响与性能：预检错误更早阻断不一致配置；隔离故障测试会临时占用 Docker/Next/浏览器资源，应串行运行并使用独立端口/dist，避免与实际应用抢端口。生产热路径本阶段不增加请求或续租频率。

回滚：仅撤回本阶段精确 diff，不 reset 工作区、不删除原有未提交内容；测试仅清理自己创建且核实身份的资源。已运行服务不会因编辑而被主动重启。

验证：定向预检/runtime/release 测试、类型检查和相关 lint；完成隔离集成补充。准备合码时才进行全工作区范围确认、完整 check/build 与 diff 检查。此次 29 项测试结果不能替代新增改动后的验证。

## 后续批准 B：真实本地配置归档、备份与运行验收

待 A 完成后提交可执行清单再批准：历史文件归档去向及 SHA、变量迁移差异、备份目录/工具/磁盘预算/调度/保留与异机位置；明确是否允许停止 manager 及已有任务的接管范围。当前无须为端口整齐重建数据库或 Redis。不因本需求重跑所有迁移或重新合并业务数据。

正式启用自动备份前先做独立空库恢复并校验数据/文件引用；保留删除策略单独授权。重启现有 Redis/数据库、实际提交业务任务及外部 API 验收均须明确范围，优先以隔离故障测试验证恢复。

## 后续批准 C：GitHub 与服务器交付

发布目标仅在确认后使用 `123.207.47.225`，不操作旧服务器。先确认全部修改/删除/未跟踪清单，特别是与 runtime 无关的业务改动和迁移，确定本次提交/发布范围；不静默漏项。

以明确 SHA 经 CI 完整验证，审阅 deployment-plan 后部署；正式 EnvironmentFile、数据库、Redis、上传对象均保留。按 registry/systemd 核对所有进程 release 路径、心跳、队列就绪和连接一致性；部署自启和主机重启验收分别记录。数据库迁移只执行批准的精确范围。回滚沿现有 release 流程且保留新增兼容列，不盲目回退无执行权校验的消费者。

## 本次实际验证及九项验收状态

本次执行：只读配置/实例/进程/队列计数/心跳盘点；运行 runtime-unification、release-runtime、deployment-plan 三个测试文件，29/29 通过。没有启动新真实 Worker、提交任务、调用供应商、停止服务、重启数据库/Redis、执行 migration、启用备份、连接服务器或 commit/push。

| 用户验收项 | 本次证据与边界 |
| --- | --- |
| 1 dev 网页 | 已有 npm run dev 进程与 3017 监听；本轮未重新启动或做浏览器验收 |
| 2 全 Worker 启动 | 已有 npm run worker manager/四 child；未重复启动 |
| 3 网页识别心跳 | 四条新鲜数据库心跳；健康 API/UI 仅有历史隔离记录，本轮未认证验收 |
| 4 页面任务消费 | 有既有运行中任务和 active 队列；不是本轮新提交验收任务 |
| 5 停止后离线 | 本轮 mock 测试及历史隔离记录；未停止真实 Worker |
| 6 Worker 重启恢复 | 本轮 manager 退避/停止单测及历史隔离记录；重计算故障仍有缺口 |
| 7 Redis 重启恢复 | 本轮未重启；历史隔离集成有证据，完整业务矩阵待补 |
| 8 数据库重启恢复 | 本轮未重启；历史隔离有心跳恢复证据，运行中发布故障待补 |
| 9 服务器部署自启 | 仅脚本/单元及发布专项测试；正式部署/主机重启未验收 |

本阶段只新增本文，不修改业务实现或运行配置。审批依据为仓库 AGENTS.md 长期安全审批及全局影响预告规则：共享 runtime、Worker、部署与存储边界改动须先明确影响、回滚和验证计划。

## 后续方案 A 执行更新

以上为首次只读盘点时状态。用户随后在当前聊天明确要求“最小代码收口与隔离验证”，方案 A 已按最小范围实施并完成隔离验证；见 `erp-runtime-plan-a-delivery.md`。B/C 未执行。其他 CLI 与 Listing AI 后台化仅提交盘点/建议 diff/schema/API 草案，没有改动其业务实现。
