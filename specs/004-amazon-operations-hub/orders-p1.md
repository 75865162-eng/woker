# Orders P1 增量实施追踪

问题定性：ERP 核心订单同步能力缺口（P1），沿用 Operations Hub 现有同步中心分层。用户已授权开始编写，但真实凭证/业务 API、生产环境操作和后续阶段仍受原任务边界约束。

## Spec

一个已批准的订单数据源执行请求处理一个确定的更新时间窗口；分页断点持久化、页事务幂等、租户/Seller/Marketplace/区域/角色预检、原始证据加密。ERP 查询面区分已提交事实和完整窗口。仅 searchOrders v2026-01-01，不提前实现 getOrder/PII、财务或退货。

## Plan

1. 审计既有 Listings/库存/日报、审批和迁移边界，明确官方模型差异。
2. 延伸现有客户端、service/processor/审批、Prisma 增量表，实现有界页处理和恢复。
3. 加入受权限约束的订单 GET 查询、现有工作台入口/策略表单。
4. 离线单元/临时数据库/浏览器验证，补运维与 PR 草案，结束 P1 等待阶段确认。

各阶段具体文件、验收和剩余 P2—P5 计划见 `docs/amazon-orders-p1.md`。

## Tasks

- [x] 保留旧三条链路，新增单一新版订单模型/请求参数。
- [x] 冻结窗口与区域，持久化 watermark/密文 nextToken，单页业务/raw/游标事务。
- [x] 业务唯一键、旧版本不覆盖、重放与第二页恢复。
- [x] 卖家/站点/区域/角色无 HTTP 预检；跨实例进程内单飞；持久化卖家/应用预算。
- [x] ERP 分页查询/窗口完整性、策略配置、loading/error/empty 与来源任务。
- [x] 迁移只在一次性 PG 验证；离线测试和旧回归。
- [x] README、AGENTS、运维、人工口径和自检记录。
- [ ] 确认脏工作区分 PR 边界后创建 P1 GitHub PR。
- [ ] 用户验收 P1；核实新版 PII/RDT 官方契约后才进入 P2。

验证结果与未运行的高成本检查见 `docs/amazon-orders-p1-validation.md`。不修改当前 `.specify/feature.json` 的其他功能工作状态。
