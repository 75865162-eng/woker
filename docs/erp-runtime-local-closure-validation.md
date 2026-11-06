# 本地收口验证记录

最新状态：本地获批切换已完成，四注册健康通过；下文暂停状态为历史记录，请以文末2026-11-07执行结果为准。
核对日期：2026-11-06，历史时区America/New_York（最新记录使用Asia/Shanghai）。用户后续选择：仅本地、不部署服务器；备份每日、保留 30 天，异机位置另指定。

## 当前已确认

- 历史完整 check:fast：1077 tests 通过，lint 0 error/6 条既有 warning，源码 typecheck 通过。不是 CI 完整构建结果。
- 本轮 `npm run typecheck` exit 0；`npx eslint scripts/runtime/local-cutover-preflight.mjs` exit 0。新脚本只读数据库/Redis/进程，不读取业务明细或输出凭据。
- 本轮 `npm run test:runtime:integration` exit 0，日志 `/tmp/erp-local-cutover-validation.log`：15 条结果。临时 PostgreSQL 上先建立无租约字段的基线，再执行本次精确 SQL，验证五项执行权测试：并发领取仅一次、图片旧执行器拒绝提交/过期接管、重试上限与旧 running 不自动恢复、事务失败回滚、mock 图片成功、商品导出文件/ExportRecord/审计成功。这里五项是 test case 数，多个断言属于同一 case。
- 同一集成继续验证实际 dev 页面、四 Worker 心跳/连接一致、重复管理器拒绝、健康错误清除旧卡片、合成上传消费、停止离线、重启、父进程强杀无孤儿、Redis 中断持久化与队列丢失恢复、PG 重启、备份恢复。
- 自建 fixture 已清理；docker ps 仅显示原有 amazon-sync-live-postgres/redis，tsconfig 无本轮 diff。不停止原有进程、不修改真实配置、不执行真实迁移。

## 报告纠正与边界

集成日志中的 `notCovered: running-task fencing for import/image` 是旧摘要，范围过宽：已证明共享数据库所有权校验及图片旧执行器拦截；尚未证明重型导入/图片计算中 OS 强杀，以及导入专属 file/export/audit 全链路的故障注入。已修正后续脚本摘要，不改写旧日志或将未跑测试记为成功。

`npm run typecheck` 现为隔离源码检查，不再把历史 .next 多 dist 的 validator 混进来；Next 启动器使用本次 dist 的类型配置，dev 验证通过。仍须 CI 完整 build 验证生成路由契约，不能把排除旧产物描述为完整生产构建已通过。

新租约 SQL 与源码已准备，真实目标库仍没有租约字段，当前不能启动新导入/图片消费者。真实配置和进程切换审批见 `erp-runtime-local-cutover-execution-approval.md`；34 个启用计划/22 个 WAITING 等均为只读时间点快照，执行前须重新盘点。

## 仍待完成

配置文件与进程切换批准、配套备份/精确结构迁移、密钥只读解密可用性检查、真实运行验收，以及两项未覆盖的隔离故障注入。Git/CI 全构建另需核对全工作区范围；没有提交/推送。服务器和正式备份不在本轮范围，不能宣布生产级闭环。

## A+B 执行进展（2026-11-07）

- A+B 与 3010 停止已获用户明确批准。
- 配置 SHA 前置条件符合。全库备份位于 `/Users/chenjieliang/.codex/backups/erp-local-cutover/20261106T160845403Z`，dump SHA256 `b954924929e1c86e7a441a721ac47a51b88c86b301d859f1b4b4b5306011e2e5`；129 张表从独立恢复库逐表计数匹配，备份文件 pg_restore TOC 通过。Amazon SP-API 三个密文均用目标密钥验证解密；Sellfox credential 与 Ads authorization 各 0 条。还没有替换 `.env`。
- 首次尝试备份在 pg_restore TOC 输入关闭时触发 EPIPE，留下另一个 515 MB 文件及配置副本目录 `20261106T160610953Z`；它不作为已验证备份，未删除。第二次完整通过，恢复库 `erp_cutover_restore_20261106t160845403z` 保留，清理须另行批准。
- 按批准范围，3017、3010、Amazon manager 和旧 Sellfox 都收到优雅停止；前三组进程退出。PID 32096/32097 在旧 Redis 6379 离线的情况下仍未退出，结合当前关闭逻辑推测在等待 Worker.close，35 秒超时后仍存活。没有强杀。此状态造成迁移/配置切换暂停，避免旧代码继续运行或新旧消费者重叠。
- 租约迁移未执行，配置/profile 源码未改；本次未主动创建、重放或消费业务任务、未修改 Redis 队列；旧 Worker 停止过程包含自身心跳写入。继续前需对当前仍匹配的 Sellfox PID 32097/32096 明确批准 SIGKILL，或先恢复旧 Redis 并重新尝试优雅停机。该追加授权仅限终止这两个 PID；之后可在原 A+B 范围内继续。


## 本地切换完成记录（2026-11-07 00:19 Asia/Shanghai）

此前“暂停、未迁移、未替换”的内容为历史过程，已由本节更新。A+B、3010停止，以及旧Sellfox PID32097/32096追加SIGKILL均明确获批。再次核对PID、父子、启动时间、命令和cwd后仅终止这两个进程，确认旧进程全部退出，无3010监听。

根.env已原子迁移并设0600，parseEnv逐值roundtrip通过；沿用联调成套密钥和目标、保留根独有值；历史配置保持原样且Git ignore生效。根SHA256为15cf7d169de1863531673928d388c7df5ba76d18d6d5a0c91f95ef60181e7600。仅执行20261106170000_runtime_execution_leases精确SQL（已审阅checksum），事务内lock_timeout=5s/statement_timeout=30s，八列/两索引/默认值复核通过，仅登记该迁移；未运行migrate deploy、db push或其他migration。两类任务表均0行。临时profile分支已退役，显式设置即拒绝。

从干净父环境启动npm run dev（3017 loopback）和npm run worker。npm PID54595/54596、manager54626、四child54629/54631/54632/54633、Next54634，cwd均正确。PID仅为当时证据，下次控制前必须复核。未重启Docker/PG/Redis，未清理uploads或旧数据。

正常既有管理员login HTTP200（凭据和cookie不输出不落盘）；健康API HTTP200，四注册各instances=1，online/queueReady/versionMatches/connectionMatches均true、queueAvailable=true。已认证GET /sellfox HTTP200。本轮没有浏览器人工交互，不将接口检查冒充UI验收。

真实消费已生效：商品Outbox wait/active/failed均0、completed4（队列记录，不等于四条业务意图），商品投影一致性无缺失。Amazon持续消费，00:19快照SUCCEEDED189，尚有WAITING/RUNNING/QUEUED；既有FAILED28/BLOCKED29保留，不能记为全业务成功。Sellfox两条历史任务各执行一次后failed：stores为HTTP401/40005客户端IP不在白名单；sales为当前工作区没有可同步店铺。未新建或人工重放测试任务；白名单处理及业务重试需另明确范围。

本轮22tests通过，源码typecheck exit0、定向ESLint exit0/无告警、git diff --check exit0。先前隔离15项集成/5case证据保留，未机械重复。已验证备份20261106T160845403Z的129张表恢复计数一致、三条SP-API密文内存解密通过，备份和恢复库均保留。

证据位于本机/tmp/erp-local-cutover-applied.json、erp-local-cutover-health.json、erp-local-cutover-final-database.json、erp-local-cutover-completed-preflight.json及final-tests/types/lint日志（均同/tmp前缀）。受限日志/PID在已验证备份目录runtime/下（目录0700/文件0600）。时间以UTC保存，本文为北京时间；PG无时区timestamp按文本读，避免node-pg本机时区解释造成八小时偏差。

本地配置与进程切换可收口。Sellfox白名单待处理；重计算OS kill、导入专属发布/审计回滚故障注入与CI完整构建仍待完成。没有commit/push，原有未提交改动保留；服务器发布/重启、正式定时备份不在范围，不能宣布生产级全部闭环。每日备份/30天仅记录偏好，异机位置待指定。
