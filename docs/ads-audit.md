# Amazon Ads 工作台现状审计

> 2026-11-06 实施更新：下文为 11 月 5 日历史审计；当前八类 SP 结构 reader 已接常规 worker，Campaign/Ad Group 本地结构页面已接服务端查询，Reporting v1 仍只有隔离协议采集，不能用于真实发布。最新本批授权连接实现、验证及真实试点边界见 [核心闭环第一批交付](./amazon-ads-core-closure-batch1-2026-11-06.md)。本条不表示真实 API 或数据库验收完成。

> 同日续批：Product Ad 已按官方 v3 合同加入，结构域扩为九类，见 [核心结构交付](./amazon-ads-product-ad-delivery-2026-11-06.md)。已有数据页与 MCP 可查保存的广告对象及 SKU/ASIN；不是广告商品日报或真实账户验收。

更新：2026-11-05。本文将《亚马逊广告工作台升级规划》映射到当前仓库；只记录本地代码与文档状态，不代表 Amazon 真实账号、API 或生产环境已验收。

## 当前实现

| 能力 | 当前仓库状态 | 主要入口 |
| --- | --- | --- |
| Ads 页面原型 | Campaign、广告组、关键词、投放、搜索词、报告等页面已存在；业务数据由 fixture/mock provider 提供，不能作为真实广告绩效 | `src/components/amazon-ads/`, `src/lib/amazon-ads/mock-provider.ts` |
| Ads OAuth 与 Profile | 独立于 SP-API；服务端配置、一次性 state、刷新令牌加密、区域 Profile 发现和 ERP 店铺绑定已实现。真实 OAuth 回调会访问 Amazon，测试必须注入 mock transport | `src/lib/amazon-ads/authorization.ts`, `src/lib/amazon-ads/oauth-contract.ts` |
| 同步任务框架 | 计划、任务、租约/围栏、队列恢复、检查点、实体/日报表结构已建立；当前读取 adapter 明确为未实现，默认不会取回真实广告数据 | `src/lib/amazon-ads/sync-adapter.ts`, `sync-service.ts`, `sync-processor.ts` |
| 广告读取 API | 有分页查询已存实体/日报事实的接口，但这不等于已完成 Amazon API 读取 | `src/app/api/integrations/amazon/ads/data/route.ts` |
| MCP/写操作 | 仓库已有 Agent Tool Gateway 与 Amazon Ads action audit/approval 边界；真实写 transport 当前关闭或未实现。不能另起一套平行变更单与审批表 | `src/lib/agent-platform/amazon-ads.ts`, `src/lib/agent-platform/amazon-action-audit.ts` |
| 报表与数据仓库 | 尚未形成 Ads Exports/Reporting 的已核验真实读取链路，也没有据此验证的广告数仓或 Ads × 经营指标口径 | `docs/amazon-ads-api-integration.md` |

本次检查时，工作区已有约 99 个已暂存文件改动，覆盖 Ads、Orders、报表接收器、Prisma 迁移、发布版本等多个范围；另有未跟踪的 `.next-amazon-live/`。这些既有改动不应被当成本审计新增的范围，也不应在未盘点时选择性提交或同步。

## 规划阶段映射

| 规划阶段 | 现状 | 可继续的下一步 |
| --- | --- | --- |
| P0 盘点 | 本文补齐 Ads 页面、授权、同步、MCP/写操作现状与冲突 | 审核并固定本审计的范围与术语 |
| P1 契约 | 尚无经仓库架构核对的 Ads 领域契约；规划中的 API 路径和表结构不能直接视为既定接口 | 在现有 Next Route Handler、Prisma、Agent Gateway、权限与审计模式上，先设计只读能力契约；逐项用官方模型核对端点、字段、分页和报告语义 |
| P2 授权 | 核心代码已存在；人类首次授权、跨区域账号和撤权/重连仍需隔离验收 | 补齐 mock 回归与隔离路由测试；真实 OAuth 联调另行明确范围和批准 |
| P3 同步 | 调度与持久化骨架已存在，Ads 读取 adapter 尚未就绪 | 先选一个有官方契约、低风险、可限量的只读实体或报告做端到端 fixture 链路；完成验证前保持 adapter fail-closed |
| P4 数仓 | 未证明需要新数仓、物化视图或 ClickHouse | 使用现有 PostgreSQL 边界先验证数据量和查询；需要新增共享模型/索引前提交影响、回滚和 benchmark 方案 |
| P5 页面 | 原型页面存在，当前不是真实数据工作台 | 按已发布真实数据能力逐页接入；来源缺失时展示明确状态，不伪造指标。暂不做全量重构 |
| P6 网关/MCP | 既有 Agent 审批与审计框架存在，实际 Ads 写入未实现且受开关保护 | 盘点现有 gateway/approval 能力后再决定缺口；写入功能须另行定义权限、逐条结果、幂等、审计、快照及回滚，并先经影响评审 |
| P7 验证 | 有 Ads 单元与浏览器测试；此审计未重跑测试 | 后续每个阶段跑其定向 mock 测试；共享 API/schema/权限阶段跑 `npm run check:fast`；合码闭环再跑 `npm run check` 与 `git diff --check` |

## 需要修正或暂缓的规划内容

1. **五窗口文件白名单与目录结构不适用。** 规划使用 `backend/app`、`web/src`、Python 启动入口和 `win_*.sql`，而本仓库是 Next.js App Router + TypeScript + Prisma，迁移由 Prisma 时间戳目录管理。应保留“模块边界、契约先行”的意图，改用仓库现有目录、权限、测试和迁移机制；不能照搬白名单、路由装配或迁移命名。
2. **不要新建第二套 MCP/变更网关。** 仓库已有 Agent 工具注册、审批确认、Amazon Ads action audit 与执行闸门。规划中的 `change_orders`、独立审计表和固定 `/api/ads/*` API 若平行落地，会重复权限与审计事实源。先复用现有边界；具体能力不足时再提交契约变更。
3. **Ads 与 SP-API 保持不同授权和语义。** 可以在受控查询层提供经营上下文，但不能把 Ads 绩效、SP-API 库存/订单或 ProductRecord 合并成新的商品事实源；跨域 join 需定义 seller、marketplace、币种、日期、归因和缺失值语义。
4. **Marketing Stream v2 不纳入首轮实现。** 该方案依赖 AWS SNS/SQS/S3 等外部基础设施、凭证、部署与持续运行成本，属于全局架构和运维变化；先用既有本地/服务端存储和批量只读链路验证需求，再单独评审 Stream 的成本、权限、回滚与性能影响。
5. **“本地永久留存”不能作为无条件规则。** 数据保留需逐类评估来源许可、隐私/组织策略、存储成本、删除请求和备份周期。Ads 原始响应、订单上下文与加密载荷应沿用现有加密、最小化和保留边界；先记录各事实的来源与保留理由，再确定期限。
6. **固定数值门槛尚无证据。** “1 万活动分页 2 秒”“与后台差异小于 5%”、默认近 7 天花费 50 美元、调价/预算幅度、冷却期和熔断阈值均不能直接写成验收或硬规则。要先验证 API 口径、站点/币种、归因窗口、数据延迟、并发与操作风险；性能目标需 benchmark，业务阈值需可审阅配置和明确负责人。
7. **API 版本与端点必须逐项核实。** 规划把 Exports、Reporting v3、Marketing Stream v2、Reporting v1 和多个管理端点组合成目标架构；不能仅依据手册或示例 URL 开始请求。以官方当前 OpenAPI/文档逐端点记录版本、角色、限流、分页、异步状态和可用字段；未核验项继续保持不可调用。
8. **不要承诺后台数据像素级对齐。** 点击词覆盖、报表延迟/修正、广告归因、经营销售分母和时区都会造成差异。UI 应显示实际来源、窗口、口径和新鲜度；TACoS 或 Buy Box 联动仅在有匹配分母和同范围数据时计算，不能以 5% 差异作通用门槛。
9. **广告写操作不是本轮自然延伸。** 当前 Ads write transport 受保护。断货/Buy Box 保护、建议、审批、熔断和回滚涉及共享权限、真实外部副作用与错误恢复；先完成只读契约和隔离验证，再提交具体写操作设计及影响/回滚/验证方案。

## 建议的落地顺序

1. 冻结并审阅 P0/P1 的 Ads 能力、来源、字段口径和现有 Agent Gateway 复用边界。
2. 在 mock transport 下为单个只读能力补齐官方契约、解析器、范围校验、限流/重试、审计与隔离集成测试；适配器未完成前保持关闭。
3. 用小范围事实验证持久化与分页查询，不预先引入 Stream、ClickHouse、额外 read model 或全量回补。
4. 逐步让现有页面消费真实发布的数据，并保留 mock 模式仅用于明确标注的演示/测试。
5. 最后单独评审真实 Ads 写操作与 MCP 开启；这不由本地 UI 或同步实现自动授权。

真实凭证、真实 Amazon 请求、现有数据库迁移、配置启用、GitHub 同步和生产部署均不包含在此审计中。
