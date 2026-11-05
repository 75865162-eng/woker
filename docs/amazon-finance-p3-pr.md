# P3 PR 草案：接入卖家级财务增量交易

原有财务域只有规划入口，无法获取交易。新增 Finances **v2024-06-19** `GET /finances/2024-06-19/transactions`，沿现有 client → finance adapter → approval/service/processor → Prisma 路径实现有界 posted 窗口、单页事务、加密游标和原始报文，按真实 transactionId 幂等更新。官方参考：https://developer-docs.amazon.com/sp-api/reference/listtransactions；角色和用例：https://developer-docs.amazon.com/sp-api/docs/finances-api-v2024-06-19-use-case-guide。

用户已明确批准卖家级采集方案：省略 marketplaceId 以支持官方美国 MFN 要求；审批冻结全部已验证站点，每个站点须具有同一 ERP 店铺的有效绑定。source marketplace 保留为管理锚点。响应卖家/站点越界整页拒绝；缺失/冲突归属进入独立密文隔离，普通查询只返回已归属事实。P3 仅实时 owner/database_admin 可采集和查看财务；site-only grant 与 MCP 不获得卖家级财务权限。HTTP 前和提交前都重新检查。

JSON number 金额按原始 lexeme 解析，NUMERIC(65,30) 不经 JS Number；折算依赖明确配置的汇率来源、版本、有效期和舍入，无汇率不折算。保留非订单交易、原始未知/null 状态和 UTC/站点时区。postedDate 不能代表状态更新版本，使用受控页面采集顺序更新当前事实，保留 raw 证据；无生产 raw 重放入口。重叠之外的递延更新仍需独立对账，窗口成功不标记最终结算完成。

新增 additive migration `20261105050000_amazon_finance_transactions`，复用已有 resource cursor、run/log/raw/page/token bucket、Redis 锁、lease/fence。400/403/404 停止，429 指数退避加抖动并持久阻塞预算，5xx 有限重试；403 保留既有授权异常行为，显式重新验证后续传。解绑 fence 财务任务并保留游标。不启用自动计划，不触碰旧三链路发布语义。

验证结果及人工门槛见 `amazon-finance-p3-validation.md`。逐页提交控制内存，但 5,000 行逐行 upsert 的最坏事务时长和 raw 存储预算未做生产承诺；响应上限 4 MiB / 5,000 行、窗口最多 30 天、每 run 最多 1,000 页 / 50,000 行。实际额度过大须缩小审批窗口，不自动历史全扫。回滚停用财务源/入口，保留数据及游标；数据库不自动回退。

本文件是本地 PR 描述草案，尚无 GitHub PR。工作区含先前 P1/P2 与其他改动，未擅自拆提交或推送混合范围。生产配置、迁移和发布需单独具体审查。
