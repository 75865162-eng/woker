# 已配置的专用本地联调环境

2026-11-04 实际检查，未提交／推送／生产迁移／部署。状态：**本地基础环境就绪，等待真实授权**。这不代表真实 Amazon API 验收通过。

| 项目 | 实际结果 |
| --- | --- |
| PostgreSQL | 127.0.0.1:55439，数据库 amazon_sync_live_local，独立容器 amazon-sync-live-postgres，仅绑定 loopback |
| 迁移 | 仓库全部 77 项已应用；Prisma migrate status 为 up to date；generate 成功 |
| Redis | 127.0.0.1:6399/0，独立容器 amazon-sync-live-redis，仅绑定 loopback；实际 PING=PONG |
| Web | http://127.0.0.1:3017/operations，完整 Next dev 服务，独立 .next-amazon-live 构建目录 |
| 登录 | 数据库认证，独立本地 owner；完整浏览器登录成功 |
| Worker | amazon-live-local-worker，独立进程，并发 1；实际页面／API 心跳在线 |
| organizationId | amazon-live-local |
| workspaceId | default，名称 Amazon 专用本地联调 |
| Amazon Seller ID／Marketplace ID／区域 | 未配置；授权表单初始显示北美不代表已选择真实目标 |
| 授权 | 待授权，数据库授权记录 0；未创建假凭证或成功标记 |
| Listings／Inventory | 基础运行环境可用；缺合法授权、真实目标范围及 ERP Seller，尚不能真实同步 |

专用 Docker volumes：amazon-sync-live-pgdata、amazon-sync-live-redisdata。没有复用既有 5432／6379／54329 服务，没有复制原数据库或测试 fixture。原 .env 保留；专用 .env.amazon-live.local 为 git 忽略文件、权限 600，包含独立生成的本地数据库密码、登录密码、AUTH_SECRET 与加密密钥。密钥未输出到终端或本文。

Web／Worker 的本地启动器将其他 .env 文件中的配置键置空，再加载专用配置；避免 Next／dotenv 隐式继承旧数据库或 Amazon 全局凭证。无 NODE_OPTIONS 测试 transport 注入。真实 Amazon 凭证从未复制到本库。所有同步计划保持停用，任务、数据源与两类 Snapshot 均 0。

## 实际验证证据

`local-environment-result.json` 是完整 Next 应用＋数据库认证＋真实专用 PostgreSQL／Redis／后台 Worker 的实测结果，不是模拟 API fixture。已验证：

- 登录页提交独立数据库账号后进入应用，/operations 显示同步中心。
- 店铺与授权→新增授权：Seller ID、授权名称、区域、官方 endpoint、三个 password 凭证字段可用；区域可切换并恢复。
- 同步设置显示 Worker 在线；settings API 实际 queueConfigured=true、该 Worker 在线。
- connections API 授权与数据源为空；本库无同步任务、Snapshot 或启用计划。
- 匿名 API 返回 401／403，未登记 Workspace 返回 403。
- 未填写／提交 Amazon 凭证，未执行真实同步，没有真实 Amazon 成功记录。

授权页面的实际空白截图在本地 `tmp/amazon-live-private/authorization-page.png`，不包含输入凭证。浏览器检查使用真实路由、middleware／数据库登录；没有使用上阶段 HTTP fixture。

## 用户接下来操作

1. 打开 http://127.0.0.1:3017/login。账号已按用户要求设置为 `1`；密码请**仅在本机**查看私有 `.env.amazon-live.local` 中 BOOTSTRAP_ADMIN_PASSWORD，不发送到聊天。登录凭证与 Amazon 凭证不同。
2. 进入 http://127.0.0.1:3017/operations，确认右上角 Amazon 专用本地联调；点击左侧“店铺与授权”→“新增授权”。
3. 填授权名称、真实 Amazon Seller ID，选择实际区域；在 password 字段填写同一合法应用的 lwaClientId、lwaClientSecret、refreshToken。页面不再提供旧凭证导入，直接配置本库真实授权。点击“保存授权”。
4. 点击该授权的“验证参与站点”。只有真实验证成功才出现可选 Marketplace；参与站点成功不证明各域角色或 Seller 声明正确。失败查看安全错误信息，不上传凭证或原始响应。
5. 核对 Refresh Token 所属 Seller 与所声明 Seller ID。当前新库没有 ERP 店铺；提供已核对的非敏感 Seller／Marketplace／店铺名称后，需在本库建立相应 SellerAccount，再在“绑定店铺／站点与数据域”选择真实授权、ERP 店铺、Marketplace，分别绑定在线商品与 FBA 库存。本版本没有独立新建 ERP Seller 页面；不能通过创建 ProductRecord 或填写虚构店铺绕过。
6. 所有计划先保持停用。凭证、资格、目标范围及 ERP 绑定确认后，再按 live-validation.md 单域逐一手动同步。当前任务是该 Seller／Marketplace 的全量快照，非少量 SKU 任务。

步骤 3～5 完成前授权状态保持**待授权**，Listings／Inventory 真实 API、分页、非零数据抽核、真实限流与双真实 Seller 均未验收。

## 本地运行维护

目前 Web 和 Worker 保持运行，PostgreSQL／Redis 容器未配置自动启动。重启本机后在项目根目录执行：

```bash
docker start amazon-sync-live-postgres amazon-sync-live-redis
node tmp/amazon-live-private/runtime.mjs start
DOTENV_CONFIG_PATH=.env.amazon-live.local node scripts/amazon-sync-live-preflight.mjs
```

私有 runtime.mjs、进程 PID、日志、验证脚本均在 git 忽略的 `tmp/amazon-live-private/`。不要清理该目录或改换加密密钥后继续使用旧凭证；它是本地运行文件，不纳入提交。日志不输出 Amazon 凭证。Node 进程不是 systemd 服务；退出或重启后需重新启动并检查心跳。Next 首次启动该专用 dist 可能自动添加 tsconfig include；本轮已撤销其自动产生的 tracked 配置差异。

停止时先确认本环境无活动任务，按私有 PID 文件核对实际 Node 命令后停止这两个进程，再停止上述两个专用容器。保留 volumes 和私有环境文件，不触碰其他服务，不删表或回滚迁移。

本轮没有业务代码修改，因此未重复构建／核心单测；使用真实服务连接、迁移状态、完整应用浏览器／认证与心跳检查作为验收，diff 检查通过。未来修改代码／迁移或准备合码时再执行相应检查。

本地管理员更新：按用户要求将该专用库原初始化 owner 改为账号 `1`，更新密码哈希并撤销旧会话；专用环境文件同步，Web 已重启。完整浏览器登录及同步中心授权页／Worker／权限检查再次通过。未修改其他环境账号，不记录密码。

统一新页面业务导航及全新库使用方式已实测，见 quick-delivery.md 最新段落；此前旧入口／旧页回退说明不适用于当前版本。
