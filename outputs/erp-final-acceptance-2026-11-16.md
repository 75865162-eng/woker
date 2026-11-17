# ERP 最终集成验收报告

**结论：NO-GO，不得部署生产。**

本轮只执行本地静态/单元检查与代码修复；未连接生产数据库、未执行生产迁移、未部署、未提交或推送。验收对象是 Commit `55d5c51affd503e641bc9aa7a5f023d6d0118b94` 加上当时未提交工作树，不是干净的单 Commit。工作树在本轮开始时已有约 230 项状态行（约 140 个 tracked 修改、90 个未跟踪文件）；期间 HEAD 曾从 `0f05efb` 前进到 `55d5c51`，因此不声称达到“同一固定 Commit 的完整最终验收”。

## 本轮证据（2026-11-16）

| 检查 | 命令/范围 | 结果 |
|---|---|---|
| Git 基线 | `git rev-parse HEAD` | `55d5c51affd503e641bc9aa7a5f023d6d0118b94`；执行中外部推进，未执行任何提交操作 |
| TypeScript | `npm --prefix C:/Users/jingbao12/Desktop/条条/woker run typecheck` | 退出码 0 |
| ESLint | `npm --prefix C:/Users/jingbao12/Desktop/条条/woker run lint` | 退出码 0，0 errors，7 warnings（2 个 `<img>`、5 个未使用符号） |
| 全量单测（使用隔离 AUTH_SECRET / AUTH_DRIVER） | `AUTH_SECRET=<isolated> AUTH_DRIVER=local npm --prefix ... test` | 退出码 1；2,100 tests，2,090 pass、10 fail、0 skipped，425,029 ms。详细 TAP：`outputs/erp-final-unit-2026-11-16.tap` |
| 全量单测失败归因 | 同上日志 | 失败涉及 sync center 工作区 scope、Lili tool-config 工作区/API 状态、选品 API 状态码、Sellfox 权限/工作区上下文；不是单纯密钥问题。未修完/未完成复验，不能报全量通过 |
| runtime fixture 密钥 | `node --import tsx --test tests/runtime-unification.test.ts`，隔离密钥 | 退出码 0；21/21 通过。修正运行态 fixture 仅 31 字符密钥，满足会话签名至少 32 字符契约 |
| 定向接口回归尝试 | 6 个测试文件；`node --import tsx --test ...` | 退出码 1；17 项中 11 pass、6 fail。发现 `npm run test` 脚本把额外过滤参数追加到 glob 后，仍运行全量；不将其当作成功定向验证 |
| Docker | `command -v docker` / PowerShell 查询 | Docker CLI 不可用；没有 Docker daemon/隔离容器证据 |
| Playwright Chromium | 检查 `chromium.executablePath()` | 当前会话对应 Chromium 文件不存在 |
| diff whitespace | `git diff --check` | 全量工作树退出码 2，报告已有的 `src/components/ui/card.tsx` EOF 空行；本轮相关文件的定向 diff 检查通过 |

上述全量单测是在同一代码工作树，但执行期间有外部工作树/HEAD活动；日志记录的是运行开始时实际加载的源码快照，不能替代最新稳定候选的重跑结果。执行时间以宿主通知的结束时间约 `2026-11-16 21:42 GMT+8` 为参考；具体测试耗时按 TAP 报告记载。

## 本轮代码变更

- `scripts/runtime/fixture-safety.mjs`、`scripts/test-runtime-integration.mjs`：将隔离运行态认证密钥从 31 字符提升到满足验证边界的随机测试专用常量，并加强 Redis 操作后的容器身份复核。
- `tests/runtime-unification.test.ts`：增加测试确认 runner 的隔离密钥可经实际 `getAuthSecret()` 校验，且不继承外部认证凭据。
- `src/app/api/operations/sync-center/route.ts`：将认证与工作区解析包含在规范化错误边界内，缺失/无效 workspace 返回明确 scope 错误。
- `src/app/api/sellfox/sync/route.ts`、`src/app/api/sellfox/schedules/route.ts`：规范化 WorkspaceScopeError，避免异常泄漏，并复用已解析 scope。
- `tests/lili-tool-config.test.ts`：请求加入明确 workspace header，并补缺失工作区拒绝及零读写/探测副作用测试。

说明：上述 API 修改来自进行中的并行处理，部分仍与当前回归失败对应；不可视为修复完成。禁止继续以降低安全断言或改成宽松状态码来“修绿”。

## 模块与核心闭环状态

现有单测覆盖若干权限/租户边界、Amazon 协议解析、精确金额、任务幂等、WMS 规则、工作簿解析和部分队列逻辑；这些单元级结果不是真实浏览器、数据库或外部账号闭环。当前没有本轮证据证明任一全站模块已通过最终前端→API→数据库持久化→查询→前端的 E2E。

- 用户/权限/租户：有大量单测；当前全量仍失败，未完成真实浏览器及数据库隔离验收。
- 商品、采购、订单、供应商、FBA、物流、库存、财务、结算：部分纯逻辑与边界测试；本轮无完整真实数据 E2E。
- WMS 质检作业：未运行双会话浏览器收货/分批质检/上架链路。
- Amazon SP-API / Ads：离线协议和能力测试不代表真实授权或真实账号联调；写操作需保持审批门禁。
- Lili / MCP / Skills / AI 查询：本轮 Lili 测试仍有失败；无真实授权数据闭环证据。
- 文件导入导出、后台任务、调度及恢复：部分代码/单测覆盖；本轮未进行数据库/Redis故障及恢复演练。
- 全局导航、工作台：类型检查通过；无本轮完整浏览器导航验收。

## 阻断项（均阻止生产部署）

1. 当前全量单测有 10 项失败，相关工作区权限、状态码与异常映射尚未逐项修复并复验。
2. 工作树很脏且发生外部 HEAD 前进；需由负责人稳定并审阅单一候选，再在其上完整重跑所有测试。本轮未 commit/push。
3. Docker CLI/Engine 未就绪，阻断真实隔离 PostgreSQL/Redis、完整迁移历史、故障矩阵、数据库备份恢复、WMS 浏览器和性能 fixture。
4. Chromium 未安装，阻断 Playwright 浏览器验收。
5. 未执行 E2E、全站 API 联调、生产构建、CI artifact 校验、权限与数据隔离集成、并发/故障恢复压力测试、备份恢复演练。
6. 生产数据库迁移状态未核对；任何真实目标库只读核验或迁移均需独立授权，本轮未连接。
7. 生产环境必填变量、Amazon SP-API/Ads、Sellfox、AI/MCP 等外部授权和正式账号状态未核实；不能虚构配置就绪。
8. 生产服务器资源、SLO、告警接收端、异机备份、恢复密钥和部署失败演练无本轮证据。

## 生产配置、部署与回滚

生产变量以 `deploy/production.env.example` 为准，至少包含环境/监听配置、TLS PostgreSQL `DATABASE_URL`、TLS Redis `REDIS_URL`、`QUEUE_DRIVER=redis`、数据库认证 `AUTH_DRIVER=database`、强随机 `AUTH_SECRET`、站点 URL/可信代理、独立加密密钥、组织/工作区范围、按启用模块配置的 Amazon/Sellfox/AI/MCP OAuth/凭据、持久文件存储、Worker 并发、备份与监控参数。真实值仅由运维写入受控 Secret/EnvironmentFile，不写入报告或仓库。

正式发布遵循 `docs/ci-cd.md`、`deploy/PRODUCTION-CHECKLIST.md` 与 `scripts/deployment-plan.mjs`：固定候选 → CI 测试和构建 → 核验 artifact/manifest/commit/hash → readiness 检查 → 审批后切换应用 release → 健康、登录、关键读写及审计检查。不得绕过 CI artifact 流程。

应用回滚按既有 CI/CD 手册切回上一 release 并恢复服务/代理配置。数据库迁移不自动回滚；不得执行未经审批的 down/drop。数据恢复必须在目标确认、事故评估与单独审批后使用已演练备份，并同时恢复上传对象和对应加密密钥。本轮未证明这些步骤可执行。

## 最终判定

**NO-GO。** 类型检查、Lint 和运行态 fixture 密钥定向测试通过，但全量单测有 10 项失败，Docker/Chromium 不可用，完整迁移、WMS、故障恢复、性能、E2E、备份恢复及生产配置/授权验收均缺当前版本证据。不得将阶段性检查包装成生产完成，也未进行生产部署、生产数据修改、Git 提交或推送。
