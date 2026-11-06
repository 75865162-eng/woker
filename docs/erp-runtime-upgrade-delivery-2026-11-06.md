# ERP 基础运行环境升级：第一阶段交付

日期：2026-11-06（北京时间）。范围：代码、模板、未启用的运行脚本、隔离验证；真实配置迁移和生产验收尚未完成。

## 已实现

- 网页、standalone、API 所在 web 进程与四类 Worker 共用 `scripts/runtime/environment.mjs`。
- 本地唯一根 `.env`；生产只读注入变量；冲突和不支持的替代加载直接失败。真实 `.env` 和联调配置均未改写、删除或上传。
- `npm run worker` 对应统一注册管理器；覆盖导入/Outbox、图片、Amazon SP-API/Ads、Sellfox，支持统一停止、重复检查及异常退避重启。
- 设置运维页展示四项注册状态、心跳、队列连接与版本；Redis 不可用不会无期限阻塞健康读取。
- 图片增加有界 queued 恢复；现有 Amazon/Sellfox/导入恢复继续复用。不冒充已解决运行中任务重放安全性。
- systemd 单 Worker 命令、生产环境标记、依赖等待及应用发布全 Worker 切换已准备；未部署。
- 数据库备份脚本、校验、流式摘要、受限权限和定时器草案已准备；未启用真实备份，未配置异机副本或自动删除策略。

运行说明：`docs/erp-runtime-operations.md`。

## 验证证据

`npm run check:fast`：1,065 个测试通过，ESLint 0 error / 6 warning，TypeScript 通过。六条警告来自通知、商品、Sellfox replica、agent market、原 queue index 及既有 Sellfox 测试文件，不做无关清理。测试数量包含工作区既有改动的测试，不全部归因于本任务。

`npm run test:runtime:integration`：使用新建、独立、固定本机端口的 PostgreSQL/Redis 容器，以及无真实凭据的白名单环境，执行真实运行入口。网页采用同一个 `scripts/next-run.mjs` 的 dev 分支并使用独立 distDir，避免覆盖现有 `.next-dev`；Worker 使用与 npm 命令相同的管理器入口。没有对已有真实服务执行重启。

| 验收项 | 已验证内容 | 尚未覆盖 |
| --- | --- | --- |
| dev 网页 | 隔离 Next dev 启动、真实数据库登录 | 真实根 `.env` 切换后的启动 |
| 所有 Worker | 四类真实子进程启动、健康 API 确认 Redis 连接 | 真实任务积压与负载 |
| 网页心跳 | Chrome 设置页显示四项在线；缺失/停止/过期单元测试 | 生产页面 |
| 任务消费 | 真实上传 API 提交合成 CSV，导入 Worker 消费并持久化预期解析失败 | Amazon/Sellfox/图片各自成功业务处理，不调用真实供应商 |
| 停止离线 | 管理器正常停止，健康 API 与浏览器均确认四项离线 | 真实系统中的强杀演练 |
| 重启恢复 | 管理器重启恢复四项心跳，单测验证异常退避和停止 | 导入/图片运行中任务 fencing |
| Redis 恢复 | 独立 Redis 重启及 FLUSHALL 后，从数据库 queued 意图重建并消费 | 所有业务类型中途丢失队列的完整恢复 |
| PostgreSQL 恢复 | 独立 PostgreSQL 重启后，四类心跳时间必须晚于重启时间 | 运行中副作用中断场景 |
| 服务器运行 | 发布计划与 systemd 离线测试 | 正式部署、主机重启与发布后验收未执行 |
| 备份恢复 | 临时数据库 custom dump 校验并恢复到另一个临时空库，核对心跳表数据 | 正式备份启用、文件对象/密钥和异机副本 |

准备合码/正式发布前再运行 CI 完整 check/build 和全改动区确认；不在本机重复生产构建。Git commit/push 与服务器发布均未执行。

## 仍需审批

1. `docs/erp-runtime-local-config-cutover-approval.md`：真实根 `.env` 迁移与数据库选择。默认库目前 ECONNREFUSED，不能假定为空；3017 的连接可读。实际停止旧进程与启动真实消费者另有范围审批。
2. `docs/erp-runtime-recovery-follow-up-approval.md`：导入和图片的运行中任务租约/fencing，需要后续 schema/processor 变更；当前未改 schema 或执行 migration。
3. 正式备份、systemd 更新、CI 发布和服务器重启验收：分别核对目标、范围与回滚后审批。

工作区原有代码、业务数据和未提交改动已保留。隔离测试创建的容器/进程与构建目录在结束时清理；失败演练的临时 fixture 日志保留在系统临时目录。Next 对 tsconfig 自动追加的本次测试路径已在退出时移除，并保留并发改动。
