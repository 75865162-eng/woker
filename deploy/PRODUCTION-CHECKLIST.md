# 生产部署前检查清单（Readiness FAIL 项收口指引）

> 本清单与 `npm run check:production`（`scripts/runtime/production-readiness.mjs`）的 FAIL 项一一对应。
> 部署到服务器前逐项勾选；前 4 项只需在**服务器的生产 env 文件**里配置，不要写进本地开发 `.env`。

## A. 生产环境文件（服务器侧，对应 `deploy/production.env.example`）

| 检查项 | 目标要求 | 需要的动作 |
|---|---|---|
| `config.node_env` | `production` | 生产 env 文件加 `NODE_ENV=production` |
| `config.runtime_mode` | `production` | 加 `ERP_RUNTIME_MODE=production`，核实 DB/Redis 的实际目标与网络隔离 |
| `config.execution_role` | `cloud` | 需官方 OAuth/读取/报表下载的生产进程配置 `AMAZON_API_EXECUTION_ROLE=cloud` |
| `secret.bootstrap_password` | 独立强口令 | 首次初始化前配置强口令；现有管理员按批准流程轮换实际账号密码。仅修改环境变量不证明数据库内账号密码已变更。 |

说明：本地 `.env` 保留 `local` 模式是刻意的（本地开发安全默认值）。上述值只写进现有 systemd 使用的服务器 env 文件（`/opt/amazon-ad-bulk-operation/.env`），验收命令：

```bash
sudo npm run check:production -- --env /opt/amazon-ad-bulk-operation/.env --gate full
```

`--gate full` 会连接该文件指定的数据库，执行前确认文件指向目标环境。

## B. Amazon 真实凭据与授权（按实际能力验收，禁止造数）

| FAIL 项 | 动作 |
|---|---|
| `amazon.sp_api_credentials` | 在生产 env 填入真实 `AMAZON_SP_API_LWA_CLIENT_ID` / `CLIENT_SECRET` / `REFRESH_TOKEN`（目前是空占位符） |
| OAuth 必填（模板已列） | `AMAZON_SP_API_APPLICATION_ID` 与 `AMAZON_SP_API_OAUTH_REDIRECT_URI` 由 OAuth consent 流程强制读取；redirect 路径须精确为 `/api/integrations/amazon/sp-api/oauth/callback`，否则授权直接失败 |
| `amazon.ads_credentials` | 填入真实 `AMAZON_ADS_LWA_CLIENT_ID` / `AMAZON_ADS_LWA_CLIENT_SECRET` |
| `amazon.authorization` | 跑 `npm run prod:onboard-amazon` 完成 OAuth 授权，产生已验证授权记录 |
| `amazon.seller_identity` | 授权后由 SP-API 核实站点身份（自动写入） |
| `amazon.sync_sources` | 在数据中心为已授权店铺启用同步数据源 |

代码内的防线（保持不动）：Ads HTTP transport 未实现时整批 fail-closed（`AmazonAdsClientError NOT_IMPLEMENTED`）；SellerSprite MCP 检测到模拟数据直接抛错；选品研究 live 模式禁止 `mock_unlimited` 预算。**不要为了消除 FAIL 而放宽这些闸门。**

## C. 数据库迁移记录（部署阻断项，需单独核实）

- 当前 readiness 会拒绝 `applied_steps_count < 1` 的已完成迁移记录。历史上曾记录 `20261214130000_sellfox_ads_proposal` 为零执行步骤，并称表结构/索引/数据已存在；这项人工说明不能替代当前目标库的可审计核验，也不能覆盖 readiness 阻断。
- 在经授权的隔离/目标环境中核实该迁移 SQL、数据库对象及 `_prisma_migrations` 记录，并按 Prisma 的迁移恢复流程形成可复核证据；未经授权不得连接或修改生产库。未完成核实前，生产 readiness 为 NO-GO。
- 其余历史迁移数量及 `prisma migrate status` 的既往记录不是当前目标库验收证据，必须对目标环境重新检查。
- 生产库迁移规则：只在获得单独批准后 `prisma migrate deploy`，禁止 reset/清库。

## D. 启动与守护（服务器侧）

- 按 `docs/ci-cd.md` 的 CI artifact + deployment-plan 流程发布；由发布脚本安装并切换 systemd 单元，勿在发布前手工启动指向旧 release 的服务。
- Web 单元为 `amazon-web`。Worker 单元以 `src/lib/runtime/worker-registry.json` 为唯一来源，当前为 `amazon-worker`、`amazon-image-upscale-worker`、`amazon-sync-worker`、`amazon-sellfox-sync-worker`、`amazon-forecast-worker`；所有进程使用同一目标环境配置。
- 验收顺序：检查 `RELEASE-RESULT.json` → `/api/health` 存活探针 → 登录 → 使用明确的目标 EnvironmentFile 运行 `check:production --gate full` → 验证商品、采购、仓库、结算页面与关键写入流程。
- `check:production --gate full` 按注册表要求全部 Worker 在 90 秒内报告 online 且 queueReady=true，拒绝已停止、未来时间和未知队列状态。该检查只验证数据库心跳报告；在已认证的 `/api/system/worker-health` 检查每个注册 Worker 的 `online`、`queueReady` 与 `connectionMatches`；仅有心跳记录或条数一致不能证明队列可消费。Worker ID 当前为 import / image-upscale / amazon-sync / sellfox-sync / forecast。

## E. 构建产物要求（CI 侧）

- CI 执行测试、lint 与 `npm run build`。构建内存应满足项目规模；可按 CI 资源配置 `NODE_OPTIONS=--max-old-space-size=8192`。保留实际构建日志，不把旧产物存在视为当前构建成功。
- 产物完整性：`.next-build/standalone/server.js`、`.next-build/standalone/.next-build/BUILD_ID`、`.next-build/standalone/.next-build/static/`、`.next-build/standalone/public/`。
- 不共享 `.next-build` 给并发构建；遇到 EPERM 或输出锁先定位持有进程与原因，不能把无证据重试视为修复。
- 按 `scripts/package-ci-artifact.sh` 与 `scripts/release-check.sh` 打包校验。发布包使用经 lockfile SHA 校验的共享 node_modules；sharp 等原生依赖必须在目标平台安装并通过启动验证，不能用本地文件数证明跨平台依赖完整。
- CI 产物必须带 `deployment-plan.json`、manifest 与 release-check。源码、依赖、迁移与运行配置按发布计划核对，测试/构建状态须来自实际执行结果。

## F. 发布前证据与运行数据保护

- 部署前盘点 `git status --short`，确认全部拟发布改动均进入同一个 CI commit；以该 commit 的测试、lint、build、artifact SHA256 和 release-check 结果作为发布证据。历史构建结果不能替代当前候选版本验证。
- `AUTH_PUBLIC_ORIGIN` 使用实际生产公网 HTTPS Origin，并核验 Caddy 与浏览器登录、CSRF 行为；本地隧道地址不能作为生产配置。
- `STORAGE_DRIVER=local` 必须挂载独立持久目录，验证跨 release 读取与备份恢复；多主机使用共享存储或配置独立 s3/r2。不得把本地 uploads、生产配置或凭据放进 artifact。
- 现有历史构建目录与业务文件的清理不属于发布步骤；不得为腾空间直接删除未知文件或运行态数据。
- 在隔离环境执行 `npm run test:runtime:integration` 等集成验收前，确认 Docker daemon、所需镜像与浏览器可用。Docker 不可用时标记 BLOCKED，不能以单元测试代替端到端验收。CI 的 `runtime-integration` job 会准备 postgres:16-alpine、redis:7 和 Playwright Chromium，再运行隔离脚本；生产发布必须等待该 job 成功。脚本在临时空库执行仓库完整 `migrate deploy`、核对迁移名称/校验和/完成状态，并再次执行验证迁移历史不变；失败即阻断后续工作流。该脚本使用临时资源，不代表目标生产环境或完整业务模块验收。
- 真实 Amazon 授权、迁移审核、存储恢复与人工业务验收分别记录结果；缺少证据时保持 NOT VERIFIED，不将本清单存在视为验收通过。
- 发布前必须确认包内 `RELEASE-METADATA.json` 与 manifest 的 commit/build/lint/tests 一致，关键启动文件、BUILD_ID 和 server/static/migrations 内容齐全；拒绝 `production.env.bak` 等凭据备份及错误目录中同名文件冒充必需资产。
- 独立部署入口须在网络操作前校验 release-check 的通过状态、commit、检查项及摘要；打包脚本的 build/lint/tests 默认 unknown 且必须显式通过。离线拒绝用例已覆盖失败/未知/缺失状态、commit 漂移、摘要错误及缺失或无效检查项；通过测试拦截 SSH/SCP 验证网络操作前阻断。仍须在固定发布版本执行测试并保留证据，不能仅凭 SHA256 相等直接部署。
- 目标运行环境必须启用 TLS 证书校验；若构建或启动提示 `NODE_TLS_REJECT_UNAUTHORIZED=0`，先修正对应进程的环境来源并重新验证，禁止将关闭证书校验作为连接故障兜底。
- `--gate deploy` 已检查 `AUTH_PUBLIC_ORIGIN`、`AUTH_TRUSTED_PROXY` 和 TLS 校验状态。生产公网来源必须为 HTTPS，代理为 caddy；两项 Amazon 写执行开关必须精确配置为 `false`，空值、拼写错误或 `true` 均阻断当前交付范围。数据库仅接受 postgres/postgresql，Redis 仅接受 redis/rediss；地址语法检查不替代连接、权限与恢复验收。

## G. 凭证生命周期监控（2026-11 升级）

依据《Amazon 数据域接入缺口清单》§9.2 / §9.10：Refresh Token 按年度重授，LWA Client Secret 每 180 天轮换。生产环境必须定期（建议每日）执行只读审计，并将非零退出码接入告警：

```bash
sudo npm run ops:credential-audit -- --env /opt/amazon-ad-bulk-operation/.env
# JSON 格式供监控系统采集：追加 --json
```

- 审计读取 `AmazonAdsAuthorization.refreshTokenExpiresAt`（授权时按 365 天写入）、SP-API 授权的 `createdAt`（年度重授基准），以及 EnvironmentFile 中的 `AMAZON_LWA_CLIENT_SECRET_ISSUED_AT` / `AMAZON_ADS_LWA_CLIENT_SECRET_ISSUED_AT`（登记签发日期，YYYY-MM-DD）。
- 状态含义：`OK` 正常；`DUE` 进入 60 天（Secret 为 150 天）提醒窗口；`EXPIRED` / `OVERDUE` 阻断（退出码 1）；`NOT_TRACKED` 表示未登记签发日期，必须补齐。
- Access Token 已在客户端按 `tokenRefreshSkewMs` 提前刷新，无需每次请求换取新 token；审计不触发任何 Amazon 网络请求或数据库写入。
- LWA Client Secret 轮换可用 Application Management API（grantless `POST /applications/2023-11-30/clientSecret`）自动化，轮换后必须同步更新 EnvironmentFile 与签发日期；加密密钥（`*_ENCRYPTION_KEY`）永不轮换，与数据库备份分开保管。

**版本核对结论（2026-11-19，对照官方文档）**：Product Pricing v2022-05-01 仅提供 `getCompetitiveSummary` / `getFeaturedOfferExpectedPriceBatch`，没有卖家自有报价接口，因此 `getOwnPrices` 保留 v0 `/products/pricing/v0/price`，不得误迁；竞品摘要已用 2022-05-01。结算报告已使用新版 `GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2`（旧类型 2026-11-11 移除），无需变更。Orders v2026-01-01 / Finances v2024-06-19 / FBA Inbound v2024-03-20 / Listings 2021-08-01 / Catalog 2022-04-01 均保持现行版本。
