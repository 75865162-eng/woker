# 本地配置切换审批单

> 最新可执行审批范围以本文末尾“2026-11-06 本地切换复核”及 `erp-runtime-local-cutover-execution-approval.md` 为准。下列早期计数是历史快照，不是当前运行状态。

日期：2026-11-06（北京时间）。本文件不含变量值或凭据；以下操作尚未执行。

## 当前只读核对结果

- 根 `.env` 的 PostgreSQL 当前拒绝连接（ECONNREFUSED），无法核实该库的历史业务数据，不认定为空库或可以删除。
- `.env.amazon-live.local` 指向的本地连接可读。只读事务核实：Organization 1、ProductRecord 1、ImportJob 0、ImageUpscaleJob 0、AmazonSyncRun 213、SellfoxSyncRun 2、WorkerHeartbeat 1。计数只代表核对当时，不是备份，也不能证明所有模块的数据完整性。
- 两文件的 DB、Redis 和多个密钥不同。Redis 队列/实例身份尚未核实，不能删除或合并旧队列。

## 建议目标

保留当前 3017 网页使用的 `.env.amazon-live.local` 对应数据库及匹配加密密钥作为本地 ERP 主运行配置；把变量迁入根 `.env`。不迁移、删除或合并任何数据库数据，不更改服务器。

## 具体文件与变量范围

正式执行前先在本机仓库外生成权限 0600 的两份配置备份，并登记备份位置；不上传备份，不写入桌面追溯或 Git。根 `.env` 原子替换为审阅后的结果，权限 0600。

| 变量组 | 拟处理 |
| --- | --- |
| DATABASE_URL、REDIS_URL | 使用联调文件的对应成套连接；执行前再确认 Redis 实例、DB 索引和队列数量 |
| AMAZON_SP_API_ENCRYPTION_KEY、SELLFOX_CREDENTIAL_ENCRYPTION_KEY | 保留联调文件中与目标数据库匹配的值，不生成新密钥 |
| AUTH_SECRET、BOOTSTRAP_ORG_NAME、BOOTSTRAP_ADMIN_PASSWORD | 保留联调文件值以匹配现有运行环境；不执行 seed 或重设数据库密码 |
| AMAZON_SYNC_CENTER_SCOPES、AMAZON_SYNC_WORKER_CONCURRENCY | 保留联调文件值；切换前审阅已启用计划及排队/运行中任务，不能把环境切换当作启动真实同步的授权 |
| AMAZON_SYNC_WORKER_ID、AMAZON_SYNC_WORKER_NAME | 核对现有心跳和进程后决定保留还是使用动态实例 ID，不静默覆盖 |
| S3_*、UPLOAD_DIR、SELLFOX_CLIENT_ID、SELLFOX_CLIENT_SECRET | 来自默认文件；必须先核对目标数据库文件引用与工作区数据库凭据优先级，不能未经核对把另一环境的存储或 legacy 凭据混入 |
| TOGOAPI_* | 默认文件中的独有值按原样保留，除非目标环境审阅发现不适用；不执行连接测试或 AI 请求 |
| SELECTION_*、WORKER_CONCURRENCY | 默认文件中的独有值核对身份/目标后保留；不启动 selection 或维护脚本 |
| AUTH_URL、NEXTAUTH_URL、PORT、HOSTNAME | 与本地 3017 访问入口核对后统一；不改变服务器地址 |
| DOTENV_CONFIG_PATH | 从新 `.env` 移除，统一加载器不再使用该变量 |
| NODE_ENV、ERP_RUNTIME_MODE | 本地模式默认 local；NODE_ENV 由启动命令确定，不从历史联调文件照搬生产标记 |

联调文件先保留为不加载的历史文件；核对通过并获得单独删除授权前不删除。旧默认数据库及 Redis 不清理、不停机；历史数据保留并登记可恢复位置。

## 进程与真实任务另批

本审批单当前仅请求核对变量和写入本地配置的范围，不请求停止现有真实进程、消费真实队列、运行真实同步或访问外部 API。真正切换前还需要一份当时的 PID/命令、目标数据库/Redis、已启用计划及 queued/running 数量清单；用户批准该清单后才能停止旧进程并启动新管理器。

回滚使用本机受限备份成套恢复文件和原命令；不覆盖业务数据、不修改现有数据库密钥。默认库当前不可达，任何重新启动/恢复该库的操作也需另批。

## 2026-11-06 本地切换复核

已更新实际库计数、队列、端口、配置指纹与 PID，见 `erp-runtime-local-cutover-execution-approval.md`。旧记录中的 AmazonSyncRun 213 等计数已过时；新快照为 255（WAITING 22），34 个启用计划，Sellfox queued 2、商品 Outbox wait 2。任何启动消费者均可能恢复真实任务，未执行实际切换。
