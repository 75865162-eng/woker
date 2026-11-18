# 本地完整检查与修复（2026-11-18）

## 验证后新增的并发改动（尚未验收）

完整验证结束后，其他窗口继续修改 `src/components/products/product-workbench-utils.ts` 和 `product-workbook-detail-sections.tsx`，新增自动 FBA 费用与表头调整。这些不在上表通过的构建副本内。追加运行 `tests/system-health.test.ts` 后，“商品真实试算函数区分缺失零和正常输入”的 fbaFee 缺失断言失败。已向用户确认是否纳入本轮及暂停并发编辑，当前不能把最新整个工作区报告为全部通过。

## 范围与修复

当前 Git HEAD 为 `2efb53e17d5d579ccaa38e870618745566e74236`；以下页面保活、测试隔离与新增浏览器用例仍为本地未提交改动。本轮按用户要求转为本地完整检查，未继续推送或生产部署。工作区同时存在其他聊天的赛狐“停止授权”实现，保留原有改动；本轮未触发该真实操作，也不宣称对它做了取消语义的专门验收。

- 页面切换：原保活实现缓存了 Next LayoutRouter，隐藏页可发出旧 segment 更新，导致链接请求 200 但地址和视图停在原页。`WorkspaceShell` 改由当前路由中的 `AppShellPage` 注册实际业务内容；路由树只渲染一次，保活层缓存业务内容。保留八标签、LRU、滚动恢复与页面输入状态。
- 性能测试隔离：为每次 fixture 建立独立模块视图和 Prisma 生成目录，避免历史 schema 生成覆盖开发/单测共用的 Prisma 客户端。
- 回归断言：多轮 Listing AI／物流／PPC 切换验证缓存视图身份和输入值，保留工作区撤权恢复、角色撤权、跨组织及停用用户断言；失败时输出 fixture 路由、标题和视图可见性。
- 原“同步没反应”：新增 2 个浏览器用例，核验 stores 请求、工作区、入队号就地显示、刷新后错误保留，且刷新不重复发起同步。

## 当前验证结果

| 检查 | 结果 |
| --- | --- |
| 完整单测 `npm run test`（check:fast 内） | 2387 通过，0 失败 |
| 全量 lint | 0 错误，5 条既有警告 |
| TypeScript | 通过；最终源码和新增浏览器测试均覆盖 |
| UI guard | 通过；无指标回退 |
| 赛狐业务浏览器 | 44 通过 |
| 赛狐凭据浏览器 | 8 通过 |
| 数据总览同步反馈浏览器 | 2 通过 |
| 完整运行态集成 | 12 项执行检查通过；全部迁移链和重复迁移幂等、注册 Worker、队列丢失、Redis/PG 重启、租约和 SIGKILL 恢复、Bulk 上传执行下载、临时库备份恢复等通过 |
| 同机 production 性能 fixture | 基线与候选均通过，20% 门槛通过；页面输入状态保留，认证隔离断言通过 |
| 完整应用本地隔离构建 | 编译、类型、lint、静态页面生成、trace 和 standalone 打包通过 |
| diff 空白检查 | 通过 |

完整运行态结果：`outputs/local-runtime-verification-2026-11-18.json`。
性能证据：`outputs/performance/local-full-2026-11-18-baseline.json` 与 `outputs/performance/local-full-2026-11-18-verified.json`。基线为现网历史版本 c5951d4，候选为当前本地修复；同机器、浏览器、production 模式及依赖环境。登录 P50/P95 27.37/30.65 → 29.61/32.69 ms；热切页 P50/P95 810.92/827.46 → 50.27/829.89 ms。原候选有切页超时，不能伪造其数值基线。更完整限制见 `docs/performance-regression.md`。

## 构建与环境边界

本地完整构建使用本次创建的隔离源码副本和独立依赖副本，未读取根 `.env`，未继承真实业务凭据，也未启动或重启本地常规服务。第一次使用跨目录 node_modules 符号链接时，standalone trace 计算了错误的拷贝目标并出现 EACCES；改为隔离依赖副本后完整构建成功，没有用忽略错误或关闭 lint/typecheck 绕过。

性能和集成只使用带本次标签的临时 PostgreSQL/Redis 及合成账号，不代表真实 Amazon/赛狐 API、GPU 图像引擎或生产验收。集成测试更新了 `docs/wimoor-integration/ui/screenshots/app-shell-isolated-routes.png` 为本次 fixture 截图，保留作为验证证据。

## 复验入口

- `npm run check:fast`
- `npx playwright test --config tests/browser/sellfox.config.ts`
- `npx playwright test --config tests/browser/sellfox-credentials.config.ts`
- `npx playwright test --config tests/browser/sellfox-hub.config.ts`
- `npm run test:runtime:integration`（只允许现有隔离脚本，先满足 Docker/浏览器前置）
- `npm run performance:build`（独立 fixture，不使用真实配置）

完整构建日志保留在 `/tmp/codex-local-complete-build-final.log`；单测、lint、类型、浏览器、性能与集成日志均在 `/tmp/codex-local-*`，为临时验证输出。GitHub／服务器未包含本轮未提交修复，不能声称三端已对齐。123 已批准的前置账号与上传目录配置仍保留；此轮没有执行生产迁移或版本切换。
