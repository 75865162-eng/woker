# ERP 统一运行入口

## 本地启动

2026-11-07已完成获批本地切换，根目录 `.env` 是本地网页/API/所有 Worker 的唯一配置源。网页与 Worker 分别运行：

```bash
npm run dev
npm run worker
```

Next 启动入口按实际编译目录加独占锁；不同端口不能共用 `.next-dev`，否则服务端代码与 React Client Manifest 可能互相覆盖并导致页面加载失败。开发与构建继续分别使用 `.next-dev` / `.next-build`。正常退出会释放锁；异常退出遗留锁时，须先确认该目录没有仍运行的 Next 子进程，再按错误提示检查并移除对应锁，不能直接删除活进程锁或清理正在使用的编译目录。

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


<!-- AGENTS migration 2026-11-08: original lines 232-252 -->

本节保留环境与数据保护硬约束；历史实现与当前代码冲突时，先核对 loader/registry，不自行切换运行目标。

## 本地与服务器运行环境统一规则

本节是本地开发、测试及 Worker 启动的配置边界；与旧文档或示例冲突时，以本节为准。它统一配置入口和每个环境内的连接目标，不表示本地与生产共享数据。

- 本地 Next web、API、CLI 和常驻 Worker 的唯一常规配置源是仓库根目录 `.env`。新增或修改变量先更新 `.env.example`，真实值只由用户在本地受控配置中维护；不得提交 `.env`、复制密钥或在启动命令、shell profile、`DOTENV_CONFIG_PATH`、`--env-file`、Next 环境文件或各服务专属 dotenv 文件中另设第二来源。
- 本地所有进程必须使用相同的 `DATABASE_URL`、`REDIS_URL` 和 `QUEUE_DRIVER=redis`。启动器应校验继承环境与根 `.env` 无冲突，连接地址采用 loopback；发现多个本地环境文件、连接目标不一致或远程地址时先停止启动并盘点，不能静默混用或自动改写配置。loopback 也可能是 SSH 隧道，需结合端口转发和数据库身份确认其实际目标。
- 每个环境只选择一套 PostgreSQL 业务库和一套 Redis/BullMQ 实例作为该环境的运行目标。web 与 Worker 的连接目标必须完全一致（包括 Redis DB index）；不得在不同 worker、测试脚本、CLI 或页面进程中悄悄切换库/Redis。生产与本地是相互隔离的独立环境，各自有自己的单一目标。
- `ProductRecord` 及其他持久化业务记录仍以 PostgreSQL 为事实源；Redis 用于 BullMQ 队列与调度，不是业务数据事实源。需要可恢复的后台任务必须有数据库任务/状态、幂等处理、租约或检查点及可重复的 queued-job 恢复路径；不得假定 Redis 队列内容是唯一任务记录。Redis 重启/清空后的恢复能力需以隔离验证为依据，不得承诺零丢失。
- 已登记 Worker 统一由 `src/lib/runtime/worker-registry.json` 描述，由 `scripts/runtime/worker-manager.mjs` 管理；`npm run worker` 启动注册的本地 Worker 集合，受支持的单 Worker 命令必须仍经同一管理器。不得绕过 manager 直接启动 Worker entrypoint、另造未登记消费者或对同一 Worker 重复启多个实例。健康状态需区分进程心跳、Redis/队列连通和代码版本；单有进程在线不等于任务可消费。
- 生产 `.env` 由服务器独立正式环境变量注入（当前 systemd `EnvironmentFile`）；web 和每个 systemd Worker 使用同一生产 `DATABASE_URL` / `REDIS_URL`，不读取本地 `.env`。生产服务的编排/恢复边界以 registry、部署清单和 systemd 为准；改动这些共享边界须先说明影响范围、回滚方式和验证计划，并经明确批准。
- 仓库中曾使用的 `.env.amazon-live.local` 及 `DOTENV_CONFIG_PATH` 是旧联调配置路径，不能再作为常规本地 app/worker 运行来源。现存文件、已运行进程、端口转发、数据库、Redis 及其中可能有价值的数据均须只读盘点；在明确目标库、组织/工作区数据量、队列范围及匹配加密密钥前，不得覆盖、删除、合并配置，切换连接，停止进程或迁移数据。不要仅因连接地址是 loopback 就认定库是空库或非生产数据。
- 隔离测试可以使用脚本显式构造的临时 PostgreSQL/Redis 与 fixture 环境，但必须不加载根 `.env`、不继承真实凭据、使用独立容器/端口和可识别的临时数据；测试清理只能删除本次创建并核实身份的资源。此例外不改变本地 app/worker 的唯一 `.env` 约束，也不授权对既有数据库、Redis、容器或运行进程做故障注入。
- 数据库备份脚本或配置存在，不等于已启用自动备份或已完成恢复演练。备份、恢复、Redis 清空/重启、定时器启用及真实运行态切换均按长期审批规则执行；恢复验证必须使用隔离目标，并同时说明数据库、上传对象/文件存储及队列任务各自的恢复边界。

### 当前运行实现核对基线

- 已检查的 runtime loader 从项目根 `.env` 解析本地变量，拒绝冲突的继承变量、额外 Next `.env.*` 文件、非 loopback 本地数据库/Redis 地址和非 Redis 队列模式；web 启动包装器及 Worker manager 复用该解析结果。改动前须以当前代码和测试复核这些行为，不能只凭本段认定所有启动入口都已接入。
- Worker registry 当前登记 `import`（含 Product Outbox）、`image-upscale`、`amazon-sync`（含 SP-API 与 Ads 队列）和 `sellfox-sync` 四类 Worker；manager 支持受控单项启动、失败退避和信号停止，子进程锁用于拒绝同一目标上的重复实例。队列恢复能力按各 worker 实现分别核实，不能把统一启动误写成统一恢复已完成。
- 服务器仍由独立 systemd unit 监督服务进程；这是统一注册/入口管理之上的进程恢复边界，不表示已经合并成一个 systemd unit。更新 Worker 入口、注册表或公共 runtime 时检查所有受影响服务与部署计划。
- 运行状态必须用本次只读命令核验并注明观察时间；进程、容器、心跳和队列状态都是瞬时事实。不得把历史测试、当前本机进程或单次健康检查写成服务器验收或持续可用证明。


### FBA 持久化外部动作（默认关闭）

`amazon-sync` 注册 Worker 的恢复扫描复用 `tickFbaRemoteActions`。只有 `AMAZON_API_EXECUTION_ROLE=cloud`、`AMAZON_FBA_REMOTE_EXECUTION_ENABLED=true`、有效的卖家/站点执行策略、独立审批及申请人显式排队同时成立才执行；配置样例保持关闭。本地开发不启用、不启动 Worker、不发真实 Amazon 请求。

动作保存在 PostgreSQL，Redis 不保存唯一业务证据。扫描有界领取、重新检查实时权限/策略/revision；SENDING 租约超时转 RESULT_UNKNOWN，禁止自动重发；已知 Operation ID 的过期 POLLING 仅恢复查询。独立核实原 Operation ID 后可以恢复 WAITING。请求/响应沿现有密钥加密，列表只返回摘要，原证据按需授权并审计。

关闭总开关或策略可停止新执行；已提交事实、未知结果和待查询状态保留，不能把停用当远程取消或自动退款。重新启用须核实策略 revision、权限、有效期及所有未知记录；不得删除动作或手工改回 QUEUED。迁移与真实开关启用沿现有 CI artifact/deployment-plan 和独立批准流程，本轮仅在临时库验证恢复逻辑。
