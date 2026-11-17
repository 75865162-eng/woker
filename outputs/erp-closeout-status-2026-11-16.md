# ERP 最终集成收口状态

## 结论

**生产判定：NO-GO。** 当前不能认定为生产级或完成最终收口。候选基线 HEAD 为 `55d5c51affd503e641bc9aa7a5f023d6d0118b94`，但最新复核工作树有 397 个已跟踪文件修改及 58 个未跟踪文件，且包含迁移、源码、测试和验收记录；它不是已固定并可复现的提交候选。

本轮未执行提交、推送、部署或生产数据库操作。没有对身份不明的本机 PostgreSQL 执行写操作。

## 本轮验证

- TypeScript typecheck：通过，退出码 0（本轮复核）。
- ESLint：通过，退出码 0；0 errors、6 warnings，包括两个 `<img>`、物流 hook 缺少 `state` 依赖、settings hook 与 `roster-auth-sync.ts` 未使用变量、一个测试未使用导入。
- WMS risk 浏览器单用例：通过，1/1。覆盖库存风险评估快照/策略作用域、幂等键和 CSV 导出；不代表完整 WMS 收货、质检、上架链路通过。
- 全量单元测试：通过，2261/2261、0 fail，串行执行并为当前进程提供 Git Bash PATH；另有 WMS 规则 11/11、广告约束/路由 12/12 定向用例通过。
- Production build：未通过。初次 `.next-build` 构建完成编译与 218/218 静态页面生成后，在 tracing 阶段出现大量 `ENOENT`；dev 停止后复跑仍因打开 `.next-build\\trace` 返回 `EPERM`。独立输出目录复跑也在打开 `trace` 时 `EPERM`。已生成的 trace 文件当前可读写，构建期间的锁定/句柄来源尚未定位。另有一份非本轮构建日志停留在启动信息且没有退出结果，不作为通过证据。
- 本地 ERP dev：按用户授权暂停后，确认原 owner 退出并清除单个陈旧 `.next-dev` 锁，已恢复；`http://localhost:3000` Ready，`/api/health` 与 `/login` 均返回 200。
- 全量测试 runner：修复 `scripts/runtime/run-unit-tests.mjs` 未转发 CLI 参数的问题，确保 `--test-concurrency=1` 传入 Node 子进程；测试隔离 PATH 需包含 Git Bash，否则调用 bash 的发布版本测试会报 `ENOENT`。本次完整运行在补充该 PATH 后通过。
- Playwright 默认配置曾错误选择商品编辑配置并因 harness 路径失败，不计入验收；正确指定 `wms-risk.config.ts` 后风险面板单用例 1/1 通过。
- Docker Engine：不可用，`//./pipe/docker_engine` 不存在。Docker disposable PostgreSQL / Redis 无法启动。

## 未通过或未执行的硬门禁

- WMS 完整浏览器业务闭环及双会话：未执行，依赖隔离数据库与容器运行环境。
- 运行态故障矩阵：未执行，Docker Engine 不可用；既有运行结果中 `completed checks: []`，不能算通过。
- 性能基准：未执行，容器创建失败。
- Prisma 完整迁移历史及迁移回滚/恢复验证：未在隔离数据库执行；仓库有 3 个未跟踪迁移，身份不明的本机数据库不可替代隔离目标。
- 全站集成 / E2E、生产构建、权限与租户隔离的真实数据库验证：未完成。
- 并发、故障恢复、压力及备份恢复：未验证。
- 同一干净候选提交上的全门禁：未实现，当前工作树大量脏改动且无候选 SHA。

## 可复现阻塞与下一步

1. 启动 Docker Desktop 并确认 Docker Engine / Compose 正常；不需要通过本机未知身份数据库替代隔离测试库。
2. 调查并修复 Next production build 在 Windows 上打开 trace 文件时的 `EPERM`，再在独立输出目录验证构建。
3. 在 Docker disposable PostgreSQL/Redis 上运行迁移、WMS 全流程、故障矩阵、权限隔离、并发与性能验证；执行并核验隔离备份恢复。
4. 对同一个明确固定的候选执行类型检查、lint、全量测试、E2E、production build 和集成门禁；再作最终 GO/NO-GO 判断。

## 工作树保护

本轮没有清理或回滚用户改动。既有并行修改、未跟踪迁移和其他文件均保留。未运行会连接真实业务数据库的迁移或写入命令，也没有提交、推送或部署。
