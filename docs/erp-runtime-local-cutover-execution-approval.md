# 本地配置、迁移和进程切换执行审批

最新状态：本地获批切换已完成，四注册健康通过；下文暂停状态为历史记录，请以文末2026-11-07执行结果为准。
状态：A+B 已批准。全库备份和恢复演练完成，3017/3010/Amazon 管理器已停止。历史 Sellfox PID 32096/32097 收到 SIGTERM 后仍未退出；根据原方案未强杀。配置尚未替换，租约迁移尚未应用，新 worker 尚未启动。此步骤等待用户批准强制终止两个已核实的 Sellfox PID 后继续。仅限本地；不发布服务器、不 commit/push、不启用正式定时备份。用户备份偏好已记录为每日、保留 30 天，异机位置待指定，未启用。

## 只读证据

复核时间：2026-11-06 10:56 历史时区America/New_York（最新记录使用Asia/Shanghai）（15:56 UTC）。运行 `node scripts/runtime/local-cutover-preflight.mjs`，数据库事务为 READ ONLY，Redis 仅 INFO/TYPE/LLEN/ZCARD，进程仅 ps/lsof。不调用供应商 API，不解密输出凭据。

| 来源 | PostgreSQL | Redis | 状态 |
| --- | --- | --- | --- |
| 根 .env | 127.0.0.1:5432/amazon_bulk_ad | 127.0.0.1:6379，默认 DB 0 | 数据库拒绝连接；Redis 读取失败，不能认定为空或可删 |
| .env.amazon-live.local | 127.0.0.1:55439/amazon_sync_live_local | 127.0.0.1:6399/0 | 当前可读；Redis 运行实例指纹 27ab40b29f6063dc |

目标 Docker 容器为 `amazon-sync-live-postgres`、`amazon-sync-live-redis`；不重建、不重启、不清空、不修改 volumes。数据库返回内部端口 5432 与宿主映射 55439 一致；仅凭 loopback 仍不作为生产身份保证。

目标库快照：组织 1、商品 1、ImportJob 0、ImageUpscaleJob 0、FileObject 0；两类任务表均没有四个租约字段。AmazonSyncRun 255：SUCCEEDED 176、WAITING 22、BLOCKED 29、FAILED 28；AmazonSyncSchedule 40，其中 enabled 34。SellfoxSyncRun queued 2，SellfoxSyncSchedule 0。Redis：商品 Outbox wait 2，Sellfox wait 2；其余四个注册队列状态计数均 0。数据库任务与标准 Amazon 队列计数不同，不能解释为无待恢复任务，也未盘点全部自定义队列。

配置文件前置指纹（任何变化均需重新核对，不静默沿用）：

- 根 .env SHA256：eea1fff8b29f9294db624a02be7ed0680f76cff49f9fe4535a6539bc1a140c91。
- 联调文件 SHA256：0ef5821a9378f3084a18867b77d58ba42bd5232e6fa8c0d778339b3074d45a47。

## A. 配置与数据库结构准备

拟操作文件范围仅限根 `.env`，历史联调文件保留；源码退役临时 profile 分支及相应测试另在本地修改，不删除历史凭据文件。

1. 创建仓库外 `/Users/chenjieliang/.codex/backups/erp-local-cutover/<执行时UTC时间>/`，目录 0700，配置备份 0600；两份原配置原样备份，不上传。备份当前目标 PostgreSQL 全库 custom dump，校验 SHA256，并恢复到同一已确认本地实例上的独立临时空库核对表计数，绝不覆盖现库。临时恢复库保留待另行清理授权。dump 不包含 uploads 或独立解密密钥；两个配置备份独立保留。
2. 原子写根 `.env`（0600）：以联调文件成套配置为基础，DATABASE_URL/REDIS_URL/AUTH_SECRET/Amazon 与 Sellfox 加密密钥均保持联调原值；不生成新密钥、不改数据库凭据、不 seed。保留联调原组织/工作区 scopes、并发 1 与现有 worker ID/name，避免改变身份范围。
3. AUTH_DRIVER/QUEUE_DRIVER/STORAGE_DRIVER 保留原相同值；PORT=3017、HOSTNAME=127.0.0.1、AUTH_URL/NEXTAUTH_URL=http://127.0.0.1:3017。UPLOAD_DIR 使用根文件既有 uploads；目标 FileObject 当前为 0，保留磁盘内容，不搬移或清理。
4. 根文件独有 BOOTSTRAP_ORG_SLUG、S3_*、SELECTION_*、SELLFOX_CLIENT_ID/SECRET、TOGOAPI_*、WORKER_CONCURRENCY 原样保留但不调用；不将旧组织 ID 当作新组织，不运行 selection、不测 AI、不使用 S3 上传、不切 STORAGE_DRIVER。其余同名冲突一律以联调成套值为准，不自动混用密钥。移除 DOTENV_CONFIG_PATH/NODE_ENV，写 ERP_RUNTIME_MODE=local；不写 ERP_LOCAL_INTEGRATION_PROFILE。
5. 对目标库只执行 `prisma/migrations/20261106170000_runtime_execution_leases/migration.sql`，SHA256 `506a4ce5405f27a26625964d5cd7a379e372a1a3f7be9123e1d280b311deda86`：ImportJob/ImageUpscaleJob 各增加 executionToken、leaseExpiresAt、executionAttempts 默认 0、maxAttempts 默认 3，以及各一个 status/leaseExpiresAt 索引。事务内执行，lock_timeout=5s、statement_timeout=30s；列已存在但结构不符即停止。不得运行 migrate deploy、db push 或任何其他工作区 migration。Prisma migration 历史登记需先核对现有记录；不伪造全库已迁移状态。

影响：两个当前空任务表短暂 DDL 锁；已有 Amazon/Sellfox 数据不修改。新 Worker 要求租约列，迁移失败禁止切新 Worker。PG 全库备份增加本地磁盘使用；实际容量预检不足即停止，不清理其他数据腾空间。

密钥边界：本轮仅核对来源/相等关系，未证明目标库全部历史加密记录均可解密。实际切换前可在内存内只读解密校验并仅输出成功/失败数；失败立即停止，不输出 plaintext、不访问外部接口。

## B. 进程切换（明确包含真实任务恢复，需单独批准）

只读发现的进程范围如下。执行前再次核对 PID、父子关系、启动标识、cwd 与实际目标；PID 被复用、所属目标改变或发现额外进程时重新提交范围。不得 pkill、killall 或按端口盲杀。

| 拟停止范围 | PID / 关联 | 影响 |
| --- | --- | --- |
| 3017 网页进程树 | 86777 → 86781 → 34134 | 网页短暂不可用，需重新登录；父进程环境确认指向 55439/6399，子进程短时连接端口并不单独证明实际 DB |
| 当前管理器及其已核实子进程 | 42910 → 42912 | 子进程已连接 55439/6399；暂停当前同步，不能把其任务恢复视为无副作用 |
| 历史独立 Sellfox 进程树 | 32096 → 32097 | 子环境仍指向旧 5432/6379，需受控停止，不能让旧代码残留 |

实际执行结果：除 Sellfox 外其余已批准进程已退出。Sellfox 收到 SIGTERM 后超过 35 秒仍在，Amazon 管理器的 WorkerHeartbeat 已显示 stopping；Sellfox 两个 OS PID 仍存在；lsof 未显示外部或 DB/Redis TCP socket，旧默认 Redis 6379 连接之前持续 ECONNREFUSED，目标 DB 中该进程也无新心跳。因为关闭逻辑等待 BullMQ `worker.close()` 且旧 Redis 不存在，可能无限等待。原批准只允许优雅停止，未授权 SIGKILL；因此停在这里，不迁移、不改配置、不启动任何新消费者。请另行明确批准强制终止 PID 32097 与 32096（仅当复核 PID/command 仍匹配时），否则可先恢复/提供旧 Redis 后再尝试优雅关闭。

3010 进程树 47352 → 47392 → 47393 → 34133 不在本次拟停止范围；它与本仓库共享目录，保留时不得声明“所有本地网页都已统一”。如需一并退役，需单独批准该树停机，不能默认为 3017 切换的一部分。

顺序：确认 A 备份有效 → 优雅停止上述已批准进程树（超时未退出先报告，不擅自强杀）→ 最后核对/执行 A 中结构迁移和配置替换 → 移除源码临时 profile 加载分支、更新相关测试 → 用干净父环境启动 `npm run dev`（3017）和 `npm run worker`（四类注册）。不从旧 shell 继承联调 profile 或冲突变量。只记录新日志到受限本机目录，禁止输出 secrets。

**启动授权必须涵盖的真实影响**：新管理器会恢复 Sellfox 2 个 queued、商品 Outbox 2 个等待项，以及 Amazon 22 个 WAITING 和 34 个启用计划所产生的后续任务；消费者可能写业务库、处理已有文件、刷新 token、访问 Amazon/Sellfox 外部 API。上述计数仅为快照，执行前数量/范围变化须重新审阅。不能只批准“显示在线”而默认批准这些操作。A 不授权 B，B 不授权新建业务测试任务或其他供应商调用。

## 验收与回滚

- 无需真实外部 API的验收：标准源码 typecheck、相关测试；3017 只读页面和已授权只读健康接口；四项注册在线/连接一致/Redis ready、旧 PID 结束、新 PID cwd 正确。健康在线不代表所有业务任务成功。真实任务消费授权后单独审阅结果，不自动新建同步任务。
- 验证配置加载器仅使用根 `.env`，临时 profile 启动应拒绝；历史配置文件留备份，不自动删除。3010 若保留，记录为本地并存入口例外。
- 如启动或健康失败，停止本次新管理器及网页，恢复成套配置和原命令（恢复真实旧消费者仍需在 B 授权范围内）；数据库新增列保留，不删列、不回滚业务数据、不重放任务。新旧消费者绝不重叠运行。
- 本地闭环不等于 CI 完整构建通过；CI 尚未执行，Git 同步/服务器部署均不属于本次批准范围。

## 批准选项

请明确批准 A，或 A+B；另明确是否批准停止 3010 进程树。批准 B 表示接受本节列出的既有真实任务和自动计划恢复及其 Amazon/Sellfox 请求。若只批准 A，则不停止现有消费者、不替换配置到生效状态、不启动新 Worker；先完成备份与迁移准备，安排 B 的受控切换窗口后才执行最终替换。


## 本地切换完成记录（2026-11-07 00:19 Asia/Shanghai）

此前“暂停、未迁移、未替换”的内容为历史过程，已由本节更新。A+B、3010停止，以及旧Sellfox PID32097/32096追加SIGKILL均明确获批。再次核对PID、父子、启动时间、命令和cwd后仅终止这两个进程，确认旧进程全部退出，无3010监听。

根.env已原子迁移并设0600，parseEnv逐值roundtrip通过；沿用联调成套密钥和目标、保留根独有值；历史配置保持原样且Git ignore生效。根SHA256为15cf7d169de1863531673928d388c7df5ba76d18d6d5a0c91f95ef60181e7600。仅执行20261106170000_runtime_execution_leases精确SQL（已审阅checksum），事务内lock_timeout=5s/statement_timeout=30s，八列/两索引/默认值复核通过，仅登记该迁移；未运行migrate deploy、db push或其他migration。两类任务表均0行。临时profile分支已退役，显式设置即拒绝。

从干净父环境启动npm run dev（3017 loopback）和npm run worker。npm PID54595/54596、manager54626、四child54629/54631/54632/54633、Next54634，cwd均正确。PID仅为当时证据，下次控制前必须复核。未重启Docker/PG/Redis，未清理uploads或旧数据。

正常既有管理员login HTTP200（凭据和cookie不输出不落盘）；健康API HTTP200，四注册各instances=1，online/queueReady/versionMatches/connectionMatches均true、queueAvailable=true。已认证GET /sellfox HTTP200。本轮没有浏览器人工交互，不将接口检查冒充UI验收。

真实消费已生效：商品Outbox wait/active/failed均0、completed4（队列记录，不等于四条业务意图），商品投影一致性无缺失。Amazon持续消费，00:19快照SUCCEEDED189，尚有WAITING/RUNNING/QUEUED；既有FAILED28/BLOCKED29保留，不能记为全业务成功。Sellfox两条历史任务各执行一次后failed：stores为HTTP401/40005客户端IP不在白名单；sales为当前工作区没有可同步店铺。未新建或人工重放测试任务；白名单处理及业务重试需另明确范围。

本轮22tests通过，源码typecheck exit0、定向ESLint exit0/无告警、git diff --check exit0。先前隔离15项集成/5case证据保留，未机械重复。已验证备份20261106T160845403Z的129张表恢复计数一致、三条SP-API密文内存解密通过，备份和恢复库均保留。

证据位于本机/tmp/erp-local-cutover-applied.json、erp-local-cutover-health.json、erp-local-cutover-final-database.json、erp-local-cutover-completed-preflight.json及final-tests/types/lint日志（均同/tmp前缀）。受限日志/PID在已验证备份目录runtime/下（目录0700/文件0600）。时间以UTC保存，本文为北京时间；PG无时区timestamp按文本读，避免node-pg本机时区解释造成八小时偏差。

本地配置与进程切换可收口。Sellfox白名单待处理；重计算OS kill、导入专属发布/审计回滚故障注入与CI完整构建仍待完成。没有commit/push，原有未提交改动保留；服务器发布/重启、正式定时备份不在范围，不能宣布生产级全部闭环。每日备份/30天仅记录偏好，异机位置待指定。
