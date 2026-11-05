# P1 本地验收记录（2026-11-05）

结论：P1 列表的历史验收加 P2 详情的最新验收可审阅；P3—P5 未放行。没有真实 Amazon SP-API/LWA 请求、真实凭证或生产迁移参与验证。P2 当轮复验结果和口径见 `docs/amazon-orders-p2-validation.md`。GitHub PR 尚未创建，不能把本记录当作生产上线验收。

## 实际验证

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| `npm run test:amazon-orders:offline` | 通过：53 单元 + 7 PG 集成 + 2 浏览器 | 仓库 fixture、注入 HTTP、临时 PG/Redis；包括最后补充的冻结区域/endpoint 校验 |
| `npm run test:amazon-sync:offline` | 通过：53 单元 + 68 集成 + 2 浏览器 | 原 Listings、库存、日报、队列、审批、多店铺/MCP 的集成回归；最后区域冻结补丁仅作用于订单，另跑 P1 回归覆盖 |
| `npm test`（check:fast 的测试步骤） | 731/731 通过 | 仓库核心回归，不访问真实服务 |
| `npm run check:fast` | **整体未通过** | 测试通过后，既有 `.next-amazon-live` 生成目录被 eslint 扫入，产生 2307 错误；没有删除该目录或改全局 lint 配置 |
| `npm run lint -- --ignore-pattern '.next-amazon-live/**'` | 0 错误、5 个已有 warning | 排除用户已有生成目录后的源码检查；warning 位于通知、商品、market、queue 和 Sellfox 测试，与本次订单代码无关 |
| P1 修改文件单独 ESLint | 通过，0 错误/警告 | 包含客户端、订单解析/预算/查询、processor/service/审批、面板和测试 |
| `npm run typecheck` | 通过 | 包含新增 Prisma 客户端类型与页面/API |
| 同步中心浏览器回归 | 29/29 通过 | `tests/browser/sync-center.config.ts`，本地 mock，含原店铺授权/审批/计划/快照/日报；另有订单浏览器 2/2 |
| Prisma validate/generate + 迁移 | 通过 | 临时 Prisma 配置，不加载实际 dotenv；迁移只在 runner 创建的临时 PostgreSQL 执行 |
| `git diff --check` | 通过 | 未创建 commit、push 或 PR |

没有运行生产构建、上线部署、真实店铺同步、真实凭证验证、年度重新授权或 secret 轮换。准备合码/部署时再跑完整 CI 构建与迁移/发布清单审查。

## 关键证据位置

- `tests/amazon-orders.test.ts`：10 个订单单元用例，覆盖窗口/重叠、UTC/null/未知状态、预算、角色/不可信参数、新版请求、单实例/跨实例刷新单飞、错误脱敏、租户查询交集。
- `tests/integration/amazon-orders.integration.ts`：7 个真实临时 PG 用例，覆盖审批→分页落库、密文 raw/cursor、重放行数不变、第 2 页失败恢复、应用预算不可重置、400/403/404/429/500、四元组不匹配零 HTTP、事务回滚、解绑 fence。
- `tests/browser/amazon-orders.spec.ts`：2 个页面用例，覆盖窗口不完整提示、UTC/null、分页、来源跳转、403 清空与空态恢复。浏览器请求全部通过本地 route.fulfill，不启动 Next 或真实同步。
- `tests/helpers/amazon-offline-network-guard.mjs`、`scripts/test-amazon-sync-integration.mjs`：环境白名单、无 dotenv、无镜像下载、隔离容器、外网拒绝、临时 storage 和 finally 清理。
- `prisma/migrations/20261105030000_amazon_orders_incremental/migration.sql`：唯一键、复合租户 FK、旧 CHECK 保留和订单模式分支。
- `docs/amazon-orders-p1.md`：架构摘要、官方链接、配置、性能/存储边界、运维和待人工确认项。

## 用户要求的逐项自检

| 项目 | 是/否 + 证据 |
| --- | --- |
| 三类新同步都能在隔离环境跑通 | **否**。本次仅 P1 Orders 列表通过；财务/退货未进入实施阶段，不能声称三类完成 |
| 没有任何真实网络请求与真实凭证参与 | **是（业务 API 与测试范围）**。测试使用虚构凭证/本地 HTTP mock，Node 外网 guard；DB/Redis 为临时 loopback。仅只读访问公开文档，不调用真实 Amazon 业务端点 |
| 全部新端点都有官方参考链接与版本号 | **是（P1）**。唯一新增 `searchOrders` v2026-01-01；源码注释和 PR 草案列出官方操作页/模型。没有猜测 P2/P3/P4 端点契约 |
| 幂等重放测试通过 | **是**。完整批次重放两次，业务行数保持 2；重复投递不额外发请求 |
| 断点续传测试通过 | **是**。第 2 页失败后重新审批 retry，请求页序为第 1、2、2 页，保留已提交记录/密文 cursor |
| 403/429 分支行为符合预期 | **是（Orders）**。403 无自动重试；429 记录 throttle/RequestId、持久化预算冷却及下次重试时间 |
| 金额与时区断言通过 | **否（完整范围）**。UTC/offset、null/新状态通过；P1 不提取金额。金额 NUMERIC/Decimal、币种及换汇断言属于 P2/P3，不伪造为已完成 |
| 日志中检索不到任何 token/PII | **是（fixture 范围）**。真实结构日志和失败消息检索虚构 access/refresh/secret/private 标记均不命中；raw/cursor 为 AES-GCM 密文，DTO 不含 token 字段。此结论不冒充生产日志扫描 |
| client secret 轮换与年度重授权已写进文档 | **是**。README 与 `amazon-orders-p1.md` 写明项目保守 180 天/年度策略；未执行真实轮换/重授权 |
| 已输出待人工确认清单 | **是**。`amazon-orders-p1.md` 包含角色、时区/起点/预算、状态、新版 PII/RDT、财务标识/汇率、退货 reportType、raw 保留期和 PR 分界 |

## 交付闸门

- P1 代码、增量迁移、fixture、测试、README/AGENTS、官方链接和 PR 草案已形成；未声称已推送 GitHub。
- 工作区含本任务前已存在及其他正在进行的改动（授权 UI/审批、多店铺文档、历史迁移、tsconfig 和生成目录等）。保留原状，推送/分 PR 前需要确认整体范围；不 reset、不 stash、不混入未知改动。
- 新版 PII/RDT 尚待官方原文核验并由用户确定方案。下一阶段仅在确认 P1 后进入 P2；P3/P4/P5继续逐阶段验收。
