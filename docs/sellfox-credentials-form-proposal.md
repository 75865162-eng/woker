# 赛狐网页凭据表单与保存方案

状态：用户已批准本地开发，并于 2026-11-06 确认目标为 3017 隔离联调环境。凭据表迁移和该环境加密主密钥已配置；未提供赛狐凭据、未启用同步或 Worker。

## 用户入口与交互

- 设置 → 集成 → 赛狐 Open API；赛狐工作台缺凭据提示直接跳转该表单。运维页保留运行状态。
- 输入 Client ID、Client Secret；都使用密码输入框，不回显已有值。首次填写两项必填；更新时留空保留该项。
- 显示当前组织/工作区、未配置/已配置、更新时间和可编辑权限。点击「保存赛狐凭据」提交，防止重复提交。
- 保存成功清空输入框，仅显示保存结果和版本。失败保留当前输入供重试；关闭、切组织/工作区和卸载时销毁内存输入，不放入 localStorage/sessionStorage/IndexedDB。
- 保存仅更新凭据，不请求真实赛狐、不验证连接、不打开同步计划、不启动 Worker。若后续需要「测试连接」，另行设计和授权。

## 拟实施的服务端边界

- 新增独立 SellfoxIntegrationCredential，organizationId + workspaceId 唯一，保存 ciphertext、revision、updatedByUserId 与时间；不借用按个人保存的 ExternalIntegrationSetting，避免多个管理员产生多个事实源。
- 使用独立 SELLFOX_CREDENTIAL_ENCRYPTION_KEY（32 字节 Base64）做 AES-256-GCM，加密附加数据包含 provider、organizationId、workspaceId。主密钥只在服务器受控环境中，浏览器不输入、不返回。缺密钥拒绝保存；不自动创建/覆盖任何真实环境文件或已有密钥。
- 新增配置状态 GET 和保存 PUT；响应仅状态/版本/时间/权限，不返回明文、密文或上游错误。响应 Cache-Control: no-store。拒绝跨源写入并限制请求大小。
- 保存由服务端从数据库重新校验当前组织有效 owner/database_admin、工作区访问权限、settings:edit 与 sellfox:create，不信任客户端角色。采用 revision CAS 防并发覆盖，凭据与脱敏审计同事务提交，审计不记录明文、密文或摘要指纹。
- 本方案的「保存」是管理员直接更新凭据，不套用 Amazon 专用审批表；不会放宽或修改 Amazon 的审批流程。该差异须随本方案批准。

## Worker、兼容与性能

- Web 状态、手动提交、计划调度和 Worker 改为按当前组织/工作区解析凭据。数据库凭据优先；未配置时保留现有环境变量路径，数据库解密失败不得静默回退旧凭据。
- Token 缓存按组织/工作区及凭据版本隔离，不继续共用全局 token。一次任务使用任务首次请求前确认的凭据版本；保存后的新版本用于后续任务，页面明确提示运行中任务不会因此自动重启。
- 凭据只由 Node Worker 用于真实上游请求，页面和保存接口不调用赛狐。保留现有串行限流、租约与任务防重。
- 新增每次状态查询、提交/调度检查和任务启动时的有界凭据读取，不对报表行逐行查询；不增加轮询频率，不引入新的 Redis 缓存。验证无跨工作区 token/凭据复用。

## 交付与验证

- 生成 schema/migration、配置读写 service/API、表单与入口、Worker scoped client、脱敏审计和文档。仅本地代码与 mock/临时库验证，不执行任何现有库迁移。
- 单测：加解密、错误 scope、留空保留、revision 冲突、权限/跨租户拒绝、无密钥拒绝、无上游调用、审计脱敏、token 隔离。
- 隔离浏览器：表单可达、必填、重复提交、成功清空、失败重试、切工作区迟到响应与输入清理。API/共享逻辑执行 check:fast；Prisma 做独立专项验证。
- 不写真实凭据、不读取私有密钥内容、不调真实 API、不启动任务、不改现有计划、不部署、不重启、不自动 commit/push。真实主密钥配置、现有库迁移和生产启用另行逐项审批。

## 回滚

- 回退表单/API/Worker 的本次应用代码；保留新增凭据表和密文，不自动删表、不回滚数据库、不改环境变量。旧应用继续既有环境变量路径；数据库新凭据不会自动转换或写回环境文件。
- 已接入保存 API。隔离测试和数据库迁移成功不代表赛狐凭据已配置；尚待用户在页面输入并保存凭据。

## 本轮验证记录

- `npm run check:fast` 的核心测试阶段 1,043 项通过；随后全仓 lint 扫描到既有 `.next-amazon-live` 构建产物，主动停止该 lint 进程，未修改既有构建目录或全局 lint 配置。
- 后续新增 Token 同 Client 跨 scope/revision 测试；`tests/sellfox-credentials.test.ts` 共 5 项通过。
- 本次文件定向 ESLint 与独立 `npm run typecheck` 通过。Prisma validate / generate 只用 fixture URL，不连接现有库。
- 一次性 PostgreSQL 集成通过：实际新增迁移、加密落库、并发 CAS 仅一方成功、跨范围隔离、实时撤权、审计失败回滚、模拟 Worker HTTP 与凭据轮换。仅本次创建的测试容器已清理。
- 5 项隔离浏览器测试通过：密码输入框、必填、防重复提交、成功清空、冲突保留输入/重新读取、权限与存储就绪门禁、切工作区迟到响应隔离。
- 本地 Next `/settings?tab=integrations` 未登录请求正常跳转登录，最终 HTTP 200 且无 CSS/模块构建错误；不代替真实账号、凭据和同步验收。
- 用户指定目标为本地隔离联调 Web `127.0.0.1:3017`，数据库 `127.0.0.1:55439/amazon_sync_live_local`；该库有 1 个组织、1 个工作区。未连接生产数据库。
- 为遵守最小变更，仅执行经批准的 `20261106150000_sellfox_integration_credentials` SQL，并用 `prisma migrate resolve --applied` 登记；订单/货件迁移 `20261106140000_sellfox_order_and_fba_shipment_snapshots` 仍待处理，未创建相关表。
- 新 `SELLFOX_CREDENTIAL_ENCRYPTION_KEY` 只写入已存在的本机私有 `.env.amazon-live.local`，以原子替换保留其余内容，权限为 `0600`；校验长度 32 字节，未输出密钥值。该文件此前没有密钥，未覆盖旧密钥。
- 本地 3017 Next.js Web 已用 `.env.amazon-live.local` 重启；进程确认读取目标隔离数据库和加密主密钥。登录页与受保护设置路径响应正常，无 CSS/模块编译错误。
- 目标凭据表当前 0 行；未写入 Client ID/Secret，未调用赛狐 API，未运行/重启同步 Worker，未更改 Redis 计划或入队任务。
- 完整生产构建/完整 check 未运行；全仓 check:fast 曾被既有构建产物 lint 扫描阻塞，专项单测、浏览器、隔离 PostgreSQL、类型和定向 lint 按前述记录通过。未 commit/push 或部署。

## 用户追加：测试连接按钮

- 2026-11-06 用户明确要求在赛狐凭据区域新增测试连接。页面新增「测试连接」，必须先保存凭据；测试不会提交未保存的表单内容、写配置、启动 Worker、启用计划或同步业务数据。
- 显式 POST `/api/integrations/sellfox/credentials/test` 按当前会话组织/工作区校验有效管理员和配置权限、revision。服务端 PostgreSQL 范围锁及 started 审计保证每组织/工作区一分钟内最多一次；审计失败不请求上游。
- 此按钮为明确的连接测试例外：只复用 `src/lib/sellfox/client.ts` 的串行限流、超时和官方 Token transport，在 Node Route Handler 请求一次 `/api/oauth/v2/token.json`，绕过 Token 缓存。不调用店铺/报表/业务 API，不创建同步任务，不需要启动 Worker。
- 返回结果不含 Token/凭据/上游原文；40005 等错误仅使用客户端固定脱敏文案。成功只代表当前凭据获取 Token 成功，不代表业务接口权限。完成后再次核验权限和凭据版本，更新后旧结果拒绝展示；脱敏完成审计与 started 关联。
- 切换工作区、重新读取、卸载时取消旧请求和结果展示；前端中止不代表服务端已经发送的 Token 请求被撤销，服务端仍受限流和审计约束。
- 本轮实现只做模拟 transport 与隔离浏览器测试；没有替用户点击真实测试按钮，没有请求真实赛狐。
- 验证结果：连接测试/凭据/既有 HTTP 客户端相关 16 项单测通过；凭据页面 8 项隔离浏览器测试通过；本次文件 ESLint、TypeScript 与定向 diff 检查通过。未运行生产构建；未更改 schema/迁移、环境文件或既有计划。
