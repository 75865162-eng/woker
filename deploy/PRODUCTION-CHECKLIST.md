# 生产部署前检查清单（Readiness FAIL 项收口指引）

> 本清单与 `npm run check:production`（`scripts/runtime/production-readiness.mjs`）的 FAIL 项一一对应。
> 部署到服务器前逐项勾选；前 4 项只需在**服务器的生产 env 文件**里配置，不要写进本地开发 `.env`。

## A. 生产环境文件（服务器侧，对应 `deploy/production.env.example`）

| FAIL 项 | 当前值 | 需要的动作 |
|---|---|---|
| `config.node_env` | 空 | 生产 env 文件加 `NODE_ENV=production` |
| `config.runtime_mode` | `local` | 加 `ERP_RUNTIME_MODE=production`（production 才允许远程 DB/Redis） |
| `config.execution_role` | `local` | 加 `AMAZON_API_EXECUTION_ROLE=cloud`（local 会关闭官方 OAuth/读取/报表下载） |
| `secret.bootstrap_password` | 3 字符弱口令 | 修改管理员「1」的密码后更新 `BOOTSTRAP_ADMIN_PASSWORD`；或执行 `npm run prod:rotate-password` 生成强口令。**上线前必须做** |

说明：本地 `.env` 保留 `local` 模式是刻意的（本地开发安全默认值）。上述值只写进服务器的 env 文件（`/etc/tiaotiao/erp.env`），验收命令：

```bash
sudo npm run check:production -- --env /etc/tiaotiao/erp.env --gate full
```

`--gate full` 会连接该文件指定的数据库，执行前确认文件指向目标环境。

## B. Amazon 真实凭据与授权（代码侧已就绪，禁止造数）

| FAIL 项 | 动作 |
|---|---|
| `amazon.sp_api_credentials` | 在生产 env 填入真实 `AMAZON_SP_API_LWA_CLIENT_ID` / `CLIENT_SECRET` / `REFRESH_TOKEN`（目前是空占位符） |
| `amazon.ads_credentials` | 填入真实 `AMAZON_ADS_LWA_CLIENT_ID` / `AMAZON_ADS_LWA_CLIENT_SECRET` |
| `amazon.authorization` | 跑 `npm run prod:onboard-amazon` 完成 OAuth 授权，产生已验证授权记录 |
| `amazon.seller_identity` | 授权后由 SP-API 核实站点身份（自动写入） |
| `amazon.sync_sources` | 在数据中心为已授权店铺启用同步数据源 |

代码内的防线（保持不动）：Ads HTTP transport 未实现时整批 fail-closed（`AmazonAdsClientError NOT_IMPLEMENTED`）；SellerSprite MCP 检测到模拟数据直接抛错；选品研究 live 模式禁止 `mock_unlimited` 预算。**不要为了消除 FAIL 而放宽这些闸门。**

## C. 数据库迁移记录（已确认非缺陷）

- `db.migrations` 提示 `20261214130000_sellfox_ads_proposal` 无执行步骤：该迁移的表结构/索引/数据**已在库中**（经手工预检确认），`_prisma_migrations` 记录因 `migrate resolve` 标记为 applied_steps_count=0。这是真实审计状态，不需要改库。
- 其余 183 个迁移全部应用，`prisma migrate status` 干净。
- 生产库迁移规则：只在获得单独批准后 `prisma migrate deploy`，禁止 reset/清库。

## D. 启动与守护（服务器侧）

```bash
# web：systemd 单元见 deploy/systemd/（推荐）
sudo systemctl enable --now <erp-web>
# worker：与 web 同机或独立机，共用同一 env 文件
sudo systemctl enable --now <erp-worker>   # 等价 npm run worker 常驻
```

- 验收顺序：`/api/health` 返回 `{"status":"ok"}` → 登录 → `npm run check:production -- --gate full` → 抽查 `/api/products`、`/api/operations/settlement-allocations`、`/dashboard` 页面。
- worker 心跳表 `WorkerHeartbeat` 近 3 分钟应有 5 条（import / sellfox-sync / amazon-data-center / image-upscale / forecast）。

## E. 构建产物要求（CI 侧）

- 构建命令：`NODE_OPTIONS=--max-old-space-size=8192 npm run build`（默认 4GB 堆会 OOM）。
- 产物完整性：`.next-build/standalone/server.js`、`.next-build/standalone/.next-build/BUILD_ID`、`.next-build/standalone/.next-build/static/`、`.next-build/standalone/public/`。
- 已知 Windows trace 间歇性 EPERM：重跑即可收敛；不要共享 `.next-build` 给并发构建。
- 本次构建已知修复：standalone 的 sharp/@swc/postcss/@emnapi 需完整（含 .mjs）；CI trace 正常时应自动带上，发布前可用 `find node_modules/sharp -type f` 对比条目数（源 103 / 产物应相同）。

## F. 已知遗留（不阻塞启动，需知悉）

- `条条/.trash-stale-builds`（约 10GB 历次构建垃圾）验收后可整体删除。
- 公网入口需跑 `start-public-tunnel.cmd`（gate 8080 需先有隧道凭据）；`AUTH_PUBLIC_ORIGIN=http://127.0.0.1:8080` 已在本地 .env 配置，生产环境应改为实际公网 Origin。
- 存在另一会话并发提交本仓库；部署前先 `git status` 确认工作区状态并统一提交。
