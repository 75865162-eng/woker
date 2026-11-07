# P1 PR 草案：补齐 Orders v2026-01-01 有界列表增量同步

状态：本地草案，尚未创建 GitHub PR，尚未部署。当前工作区已有其他未提交改动，必须先审阅完整改动区和分 PR 范围。

## 问题与结果

原同步中心 Orders 标记规划中，缺少按窗口推进的列表事实和恢复游标。本变更复用现有审批/队列/SP 客户端，在一个执行审批内读取一个更新窗口，逐页事务提交基础订单、加密原文和游标；失败恢复页而非回扫历史。ERP 增加明确标注不完整窗口的订单列表。

## 设计取舍

- 仅 searchOrders，不实现 getOrder/PII/RDT、财务或退货，保留阶段闸门。
- 增量事实表采用租户/卖家/site/order 业务键，与旧不可变库存/在线商品快照发布规则分开。
- 角色为管理员核实并审批的声明，不伪造 Amazon 已验证角色。配置与执行审批保持独立。
- 单页释放 Worker，不为低速 Orders 长时间 sleep；token bucket 持久化，LWA 按授权版本做进程内单飞。
- 原始 JSON 加密，普通读面不暴露密文或 token；仅成功页留档，不新增生产回放入口。
- P1 不自动调度下一窗口；既有执行授权的截止时间不被绕过。

## 端点官方依据

Orders **v2026-01-01** `GET /orders/2026-01-01/orders` / `searchOrders`：

- https://developer-docs.amazon.com/sp-api/reference/searchorders
- https://github.com/amzn/selling-partner-api-models/blob/main/models/orders-api-model/orders_2026-01-01.json

不存在新增 v0 操作。P2 PII/RDT 以官方合同核验为前置，当前不猜测。

## 迁移与风险

新增迁移 `20261105030000_amazon_orders_incremental`，新增事实/游标/raw/预算表与授权角色元数据，只在隔离临时库执行。每页增加预算/遥测与原文写入，生产容量/存储保留期需评审。回滚停用订单绑定/应用入口，不执行向下迁移。

## 验证

详见 `amazon-orders-p1-validation.md` 的实际运行结果及局限。合码/上线前仍需完整 CI `npm run check`、迁移审核、dirty scope 审阅和 artifact 发布；当前不构建或发布生产版本。
