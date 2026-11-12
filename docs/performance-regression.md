# ERP 性能回归基线

本地浏览器实测于 2026-11-11（Chrome、`localhost:3017`、Next 15.5.28 dev/Turbopack）：Listing AI → 物流 RSC 请求总计 1,000 ms，其中服务端首字节等待 921 ms；热切回 Listing AI 仍需 493 ms。登录页 HTML 194 ms。数据库 loopback TCP 建连 14 ms，五次 `SELECT 1` 为 0.5–2.1 ms，采样时无锁等待。因此主因不在基础数据库网络往返，必须进一步检查页面服务端工作和构建扫描。开发服务器请求日志中还观察到 workspace、通知接口在页面进入后运行。

本地 Tailwind v4 PostCSS source-scan 微基准（本次同一进程、当前工作区源码）：扫描仓库默认来源耗时约 1,157 ms；显式限制到 `src/` 后约 69 ms。原工作区含 `.next-process-*` 和多份生成产物，默认仓库根扫描会重复解析大量动态 JS/TS 候选值。全局 CSS 现限定扫描根为 `src/`，保留真实应用组件和样式来源。

## 验证命令

```sh
npm run performance:dev
npm run performance:build
npm run check:fast
```

本次隔离 production fixture（Node 24.18、Chrome、同一台开发机）得到登录热请求 P50/P95 30/35 ms，三条页面冷进入 175/835/361 ms，RSC 请求 3–45 ms。前三次页面切换约 0.8 秒，之后热切换约 37–67 ms；测量期间公共 Shell DOM 保持同一实例。数据支持首轮客户端模块加载和开发编译是主要等待来源，基础 SQL 与服务端 RSC 不在秒级。该 fixture 不代表生产验收，也不能把单机耗时作为其他机器的固定门槛。

dev fixture 必须与项目实际命令一致使用 Turbopack；如 Prisma schema 校验在临时库启动前失败，先处理 schema 校验失败，不能用 Webpack 结果替代 dev/Turbopack 基线。本工作区的 WMS schema 当前有复合关联唯一约束错误，故 dev/Turbopack 基线尚未完成。

性能脚本基于真实 `/listing-ai`、`/logistics`、`/workspace` 页面和数据库会话认证，在本次新建并标记的 PostgreSQL Docker fixture 中运行。它为每次运行建新容器，限制临时数据库、临时文件和浏览器的外部网络访问；绝不读取仓库 `.env`、调用真实业务 API、启动 Worker、触碰当前数据库/Redis或复用现有容器。退出时仅清理携带本次随机标签的 fixture。运行前需本地 Docker、`postgres:16-alpine` 镜像和 Chrome/Playwright Chromium；生产构建测试在隔离目录完成，不会重启本地应用。

输出记录登录冷请求和热请求 P50/P95、冷页面切换、热 RSC 切页响应与总时间、Shell DOM 节点身份及导航期间工作区／通知请求数。测试同时验证实时角色撤权、禁用用户、不同用户/组织隔离。首次开发编译计入冷页面指标；开发和生产模式分别比较，不互作对照。`tests/performance-architecture.test.ts` 和认证/缓存隔离测试由普通 `npm test` 及 GitHub CI 自动执行；PR CI 在同一 runner 上分别测量 base 与候选 production fixture，登录和热切页 P50/P95 任一超过 20% 即失败，并断言九次热切页至多有一次工作区初始化请求、没有通知请求。基线只用于同一 runner、运行模式、浏览器和依赖环境。

跨租户权限从不按客户端角色声明授权。会话查询每请求核验 session、活跃用户及其组织 membership；角色目录每请求读最新 revision。当前去重仅在 React server render 或同一个 Request 对象生命周期内，不存在带 TTL 的跨请求授权缓存，因此权限修改和停用在下次请求立即生效。

## 门槛与解释

使用 `--baseline=/path/to/same-mode.json` 对照同设备、同环境、同路由和同样的七次登录及九次热切页；P50 或 P95 超过基线 20% 即失败。基线只能在认可的同类环境复测并审查后更新，不能因回归调整基线。外部字体下载不计入本夹具；开发冷启动与 build 测试分别记录。真实业务库当前负载、生产环境、移动网络与全部业务报表不是 fixture 的验收范围。
