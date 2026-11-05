# Amazon Ads 测试 Profile：真实验收准备

状态：被依赖阻塞，尚未授权执行。此文档不是启动真实同步的批准，也没有读取现有数据库或任何环境凭证。

## 当前本地实现可验收的范围

- 八类 SP 结构 transport、worker、当前快照、API/UI、显式授权的实体 MCP；隔离 PG/Redis 已验证。
- 报表统一查询、显式报表 MCP，以及隔离环境专用 staging/发布/撤回恢复函数已实现。报告 adapter/worker 仍关闭；真实报表合同未核实，不能纳入此次结构测试批准。
- 当前结构 worker 会遍历八类实体，不能将其描述为 Campaign-only 任务。未返回行不删除；多页不是全域原子发布。

## 批准前需要明确的目标

请从既有 ERP Ads 账户页选择一个已授权且绑定的测试 Profile，仅提供以下非敏感标识（不提供 token/密钥）：目标本地隔离环境、ERP organization/workspace、店铺、Marketplace、Ads 授权账户内部 ID、Profile 内部 ID、Amazon Profile ID、区域 NA/EU/FE、币种及 IANA 时区。必须核对这些标识在目标环境真实一致，当前未填写、未核验。

候选范围：一个 Profile、一个店铺/站点、八类 SP 结构的只读请求，不包含写接口或报表。与生产和现有自动计划隔离，不扩全局 allowlist，不启动共享 standard worker。

## 执行门槛（未满足）

1. 明确目标库/Redis 与已有进程、任务和自动计划隔离；核对 schema/migration/Client。并行新增 migration 需独立审阅，不能拿当前 schema 的 db push 作为真实迁移验收。
2. 提交具体运行命令与运行配置的脱敏 diff，说明读取哪些私有配置、写入哪个隔离库、如何暂停及恢复；本轮没有生成或修改真实配置。
3. 实现并以 fixture 验证测试运行的持久化请求预算/截止时间。候选预算：八类 collection，每类最多两页；总实体 HTTP 最多16次、额外重试最多8次，LwA refresh最多1次，15分钟截止。超预算保留 checkpoint 并明确停止，不标成功。当前通用结构 worker 的10000页保护不能替代此预算，未经这项代码/命令审核不得启动。
4. 重新核对官方端点/账户可用性，使用保存的授权 Profile header 和其区域 endpoint；不临时发起 OAuth 重连、Profile 发现或修改绑定来绕过问题。
5. 用户针对以上目标、精确命令、预算、写入范围和配置 diff 单独批准。既有本地代码审批不覆盖这些真实操作。

## 验收与暂停/恢复

通过标准是读取到真实上游响应并正确落库，父级/Profile隔离成立，服务端 total/筛选与行一致，页面/MCP标识来源和同步时间。响应为空、限流或权限失败均如实记录，不用 fixture 补齐，不把部分页称全量。

出现401/403、区域/Profile不符、未知响应、预算/时限或权限变更即停止；不打印 token、完整上游正文或临时下载 URL。暂停/取消目标任务后保留已存行与 checkpoint；回滚代码不删除真实数据。任何计划/凭证/配置变更都须按实际目标单独批准。

第一个 Campaign Performance 日报须另行核实 reportType/query fields/groupBy、日期/归因/延迟窗口、币种/时区、下载白名单与压缩/分片校验；隔离发布服务当前有环境硬门禁，不可用于真实报告。
