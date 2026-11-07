# ERP 统一运行入口

## 本地启动

2026-11-07已完成获批本地切换，根目录 `.env` 是本地网页/API/所有 Worker 的唯一配置源。网页与 Worker 分别运行：

```bash
npm run dev
npm run worker
```

`worker` 一次启动现有四类进程：导入及商品 Outbox、图片处理、Amazon SP-API/Ads、Sellfox。Ctrl+C 会停止该管理器拥有的全部子进程；异常退出按 1～30 秒退避重启。重复启动检查失败时整组停止启动，避免只启动一部分。不要把“心跳在线”理解为业务接口权限或任务执行成功。

无需启动真实进程即可检查注册项：`npm run worker -- --list`。保留的专用命令供 systemd 和排障使用，均经过相同环境加载器：`worker:import`、`worker:image-upscale`、`worker:amazon-sync`、`worker:sellfox-sync`。不得绕过管理器直接运行 `scripts/*-worker.ts`。未纳入注册的 Listing AI optimize 仍在请求内执行；这里只统一已有后台处理，不声称所有 AI 请求都已持久化。

`scripts/runtime/environment.mjs` 默认统一解析 `.env`，变量值按 Node parseEnv 字面值处理，包括 `$`。拒绝不同来源的冲突变量、非根 `.env` 的 DOTENV_CONFIG_PATH、Next 自动识别的额外环境文件、非 loopback 的本地 DB/Redis、非 Redis 队列模式。2026-11-07 本地获批切换后，临时 Amazon profile 加载分支已退役；设置 ERP_LOCAL_INTEGRATION_PROFILE 会明确拒绝启动。历史 .env.amazon-live.local 仅保留备查，不再由运行时读取。网页与所有注册 Worker 统一读取根 .env。Next 后续环境解析被阻止，防止引入第二来源；升级 Next 后须重新验证此边界。本地启动需要支持 `node:util.parseEnv` 的 Node 20.12+，生产沿用项目既有 Node 运行要求。

loopback 不证明目标一定是本地：SSH tunnel、端口转发或代理可指向生产。迁移前必须核对实际实例和数据库身份，不能用地址检查代替人工确认。配置修改后要整套重启网页与管理器；管理器不会把新文件配置混入仍运行的旧父进程。

## 心跳和故障

入口：`/settings?tab=operations`。全局健康 API 保留原字段，额外返回四项注册状态，即使未启动也能看到。显示数据库心跳、最近时间、Redis 连接状态、在线实例数和 release commit。正常停止写 stopping；强杀或断库不能写 stopping 时，90 秒无心跳显示离线。心跳每 30 秒更新，页面点“刷新”重新读取。

同一 Worker 的心跳写入不并行堆积：停止先等待在途 online 写入，再提交 stopping，并拒绝后续 online 写入。健康读取失败时页面清除上次健康卡片并显示错误，不把旧在线状态当作当前事实；请求序号保护刷新和卸载时的迟到响应。

注册卡片另显示“与网页连接目标”：一致、不一致或尚未确认。服务端使用 AUTH_SECRET 对规范化的数据库 host/port/path、Redis 协议/host/port/DB index 与队列模式生成 HMAC，只在心跳中保存内部比较值；健康 API 剥离该值，只返回比较状态与不匹配实例数。任意在线实例不匹配都会提示，不会被另一个正常实例遮住。旧版心跳、缺少配置或全部离线为尚未确认；AUTH_SECRET 不同也会提示不一致。比较忽略连接用户名/密码，不输出连接串；它比较配置目标，不能证明 DNS、SSH tunnel 或代理后实际数据库身份相同。

队列不可用时健康读取最多等待约 1.5 秒后仍展示数据库心跳，并提示计数未知；这不是任务成功率或上游健康检查。发布版本通过 RELEASE.json 获取，开发为 development。受控 Amazon Worker 使用独立队列，不能冒充标准队列的在线消费者。

同一机器同一 DB/Redis/注册项使用临时目录进程锁；保守对待损坏锁和 PID 复用，不会自动杀死其他进程。锁冲突先查拥有者，不能直接删除活进程锁。此锁不是多主机执行租约，跨主机仍依赖业务数据库 claim/fence。

## 数据库与恢复边界

所有模块仍使用单一 `DATABASE_URL` 和 Prisma；不合并数据库、不改变组织/账号/店铺隔离。ProductRecord、派生读模型及 Storage 边界保持原实现。

- Amazon/Sellfox：复用各自数据库意图、租约、游标和队列恢复，保留批准/范围/幂等检查。
- 导入：复用既有 queued 扫描；不直接重置 running。
- 图片：新增每 30 秒扫描最多 50 个 queued 任务并重建消息，不直接重置 running。
- 导入/图片已实现token、120秒租约、20秒续租、过期有界恢复和事务发布fence；旧无token running不自动接管。方案 A 已补充商品导出旧执行器拦截、最终审计失败事务回滚、导出发布前与 mock 图片 CPU 阶段的 SIGKILL 恢复；原生图片引擎/Bulk 解析内部强杀和运行中数据库重启仍未覆盖，失败任务不无界重试。

Redis 不成为业务事实源，不删除业务任务；恢复测试应区分网络重连、重启和完全丢失队列三种情况。恢复心跳也不等于任意已运行任务可安全重放。

增量完善：持久化成功后的导入/图片队列投递失败会返回 `dispatchDeferred: true`，保留 queued 和输入文件，等待恢复轮询；这不表示业务执行成功。管理器和子 Worker 通过 IPC 绑定生命周期，父进程被强杀后子进程仍会受控结束。详细范围和最新验证限制见 `erp-runtime-hardening-2026-11-06.md`。

## 服务器交付

服务器仍使用独立正式 EnvironmentFile；web 和四个既有 systemd 服务注入 `ERP_RUNTIME_MODE=production`，只使用注入的变量，不读取 release 内的开发文件。`amazon-worker` 改为 `worker:import`，防止它再启动其他三个服务。所有应用发布均安排四类 Worker 切换新 release，沿用现有 PID/cwd 核验；文档发布不重启。数据库迁移/依赖安装仍按原 CI 清单按需执行。

必须连同本次 systemd 单元更新一起发布。只同步 package.json 而不切换服务会造成重复消费者或本地模式启动失败。服务 `Restart=always`、`WantedBy=multi-user.target` 和不限制依赖等待次数的配置已准备；需审批后安装/enable，再通过真实发布与主机重启验证。未在本任务执行服务器安装、重启或部署。

回滚恢复原启动命令、服务单元和应用 release；不自动回滚数据库，不删除或重置任务。真实配置迁移及后续 schema 变更分别审批。

## 备份（脚本已准备，尚未启用）

`scripts/runtime/backup-postgres.mjs` 要求显式 `--apply --directory=/approved/path`；目录必须在仓库外，权限 0700，文件 0600。通过 libpq 环境变量向 pg_dump 传凭据，不放入命令参数；生成 custom dump、pg_restore 目录校验和 SHA256，失败清理 partial。按流计算校验和，避免把整个备份读入内存。备份锁冲突需人工确认；不自动清理历史备份。

`deploy/backup/` 提供每天北京时间 03:30（最多十分钟抖动）的 service/timer 草案，未被发布脚本自动安装或启用。启用前另批准目标实例、备份路径、容量预算、保留期限、监控接收方式及异机副本。宿主需安装与服务器兼容的 pg_dump/pg_restore；本机当前未发现 pg_dump，不会自动安装。定时失败由 systemd 状态和 journal 记录，尚未接入主动通知。

数据库 dump 不包含 local uploads/R2 文件对象，也不包含数据库凭据解密所需的独立密钥。文件对象、密钥及离机备份要分别制定策略。恢复只对独立空库演练，不覆盖当前库；核对 SHA256、执行 pg_restore --exit-on-error，再核对组织/任务/商品数量及引用，不把 list 校验当作完整恢复演练。

## 隔离验证

```bash
npm run check:fast
npm run test:runtime:integration
```

集成脚本只使用已经安装的 postgres:16-alpine、redis:7 和 Chrome，不自动下载或安装。通过显式允许列表构造临时环境，不读取 `.env`、不继承真实凭据；创建有独有名称的临时容器/数据库与存储，固定测试端口以支持重启。经真实网页、数据库登录、健康 API 和上传 API 验证；测试输入是故意不可解析的合成 CSV，断言持久化解析失败，以证明消费链路，不伪造业务同步成功。只操作自己创建的容器/进程，结束后清理；失败保留脱敏 fixture 日志。

完整 check/生产构建留到批准合码或 CI 发布；真实外部 API、生产配置、已有进程及服务器验收另批。工作区原有业务改动与 migration 不属于本次自动执行范围。

方案 A 最新代码、验证及边界见 `erp-runtime-plan-a-delivery.md`；CLI 配置入口盘点和 Listing AI schema/API 草案见 `erp-runtime-plan-a-cli-and-ai-draft.md`。Amazon 预检入口收口不表示 Listing AI 后台化已实施；`amazon-sync-live-preflight.mjs` 仅检查 Amazon 本地配置。

隔离集成结束会恢复自己写入 `next-env.d.ts` 的路由引用，并清理自己的 tsconfig include；保留测试期间其他编辑及原始基线。已有基线可能指向历史目录，多 dist 的 LayoutRoutes 冲突仍需在一致生成类型环境解决；源代码隔离类型检查通过不等于标准 `npm run typecheck` 或生产构建通过。


## 当前本地实例

2026-11-07使用既有本地PostgreSQL55439、Redis6399/0，网页3017，3010已停止；未为统一端口重建。四注册在线/队列就绪/连接一致已通过认证健康API。Sellfox受IP白名单限制，需处理后明确业务重试范围。源码typecheck通过但不能替代CI完整构建。见本地验证记录及审批文末执行结果。
