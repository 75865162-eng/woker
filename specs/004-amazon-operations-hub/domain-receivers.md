# 订单商品、结算、赔偿、库龄

需求：复用现有同步中心完成配置→审批任务→密文原件→标准化→查询/日期筛选→来源任务与错误日志，遵守多租户隔离和商品事实源边界。

计划：先打通既有 OrderItem 查询；扩展现有 Reports 执行器与审批策略，增加报表 document/line 事实、后端分页与承接页。结算只 getReports 发现；库龄仅快照；未验证角色不伪装为成功授权。

任务：
- [x] 审查并登记 API/数据/权限/已有改动边界（docs/amazon-domain-receivers.md）。
- [x] OrderItem 查询、筛选、父单关联、列设置及来源任务；分页计数按父订单。
- [x] 报告策略、冻结范围、三域适配与 migration 文件（仅编写，未执行）。
- [x] 报告密文存储、白名单标准化、幂等行写入、分批恢复与发布。
- [x] 报告查询、分页、日期含义与 UI/任务追踪。
- [x] FBA Inventory Ledger Detailed View 库存事件接收器、闭合日期与事件类型审批范围、脱敏查询页和隔离 PG/Redis fixture。
- [ ] 完整 check:fast、lint/typecheck；真实角色、Marketplace 可用性和 Amazon 报告回归仍待受控环境验收。

已知限制：订单标题不是 Orders API 当前持久化字段，页面显示空值；Settlement `getReports` 仅发现其返回的报告，报告行的业务日期从原始报告字段读取，发现窗口按报告创建时间；赔偿和库龄只创建审批范围内的请求报告，创建结果不确定时 fail closed；库龄是当前快照。报告通用列只留在加密原始页，不写入标准行字段。

CLI 未安装（command -v specify 无结果）；复用已初始化 .specify 和现有 004 规格链路记录，不安装依赖或重置工作区。
