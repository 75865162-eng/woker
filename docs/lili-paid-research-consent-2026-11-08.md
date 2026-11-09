# Lili 付费研究一次授权配置

## 范围与实现

用户明确要求“一次批准直接跑，不再页面重复审批”。本次为当前管理员账号、amazon-live-local 组织的 default 工作区保存授权，不改变其他账号/工作区默认设置。持久化复用 ExternalIntegrationSetting，provider=lili-research-paid-consent-v1；不改 .env、凭证、schema、迁移、worker 或服务器。配置保存要求 agents/approve，写入 AuditLog。模型与 MCP 没有设置或批准授权的工具，不能通过请求参数启用此选项。

服务端按组织/工作区/用户读取配置。真实任务 step 复用配置建立任务级授权，逐笔请求关联该授权并保存；已有 MCP_CALL 等待任务下一次 step 可直接执行。MCP research_read 返回 CONTINUE，不再要求用户点击页面。meta_get_market_access 返回 approval_required=false、reason=SAVED_PAID_RESEARCH_CONSENT；仍不开放直接调用供应商工具的通道。

保留 agents 角色权限、凭证工具清单、任务 ownership/凭证绑定、只读工具及参数 schema 校验、有限任务预算与账号余额、未知请求结果核对、不自动重放、NICHE/FINAL 人工业务确认。成功响应的费用金额可为 UNKNOWN，不因此逐笔暂停。

## 本次运行核验

2026-11-08 北京时间 14:33 保存配置并回读，授权记录 ID e72de235-a478-4813-96b2-5b1a33529ae7。通过 Codex 原生 MCP 核验，普通 lili 已返回 approval_required=false / research_access=true。

任务 5999725f-8617-4743-990d-e5adf439f941 原绑定 lili_research_acceptance 的设备凭证；普通 lili 访问返回404，未放宽或改写绑定。使用其原有连接读取时返回 CONTINUE，随后执行一次 research_step，sellersprite__keyword.related.list 返回 SUCCEEDED，任务 RESUMABLE / gate=null，保存了 consentId。本次仅执行这一个已获授权的付费市场请求，未继续后续查询；供应商实际积分/金额尚未核实。没有完成第1阶段细分研究。

## 验证与回滚

隔离回归覆盖无配置继续等待、错误用户的配置不生效、已有等待任务无需页面决定即可执行、新任务直接执行、任务上限仍阻止发送、NICHE仍暂停。原有未知结果核对与 schema 变化回归继续运行。API mock 补充配置存储的空记录返回。

关闭未来自动授权：受信任管理员使用 src/lib/selection-research/paid-call-consent.ts 的 savePaidCallConsent(scope, false)，沿根目录 .env 的受控数据库入口执行并记审计；不暴露成 MCP 自我授权操作。关闭配置不撤销已经保存的任务级授权；需要停止某个已授权任务时使用既有 pause/cancel。若回滚源码，先关闭配置，再还原本次 consent 读取、引擎接入和元数据提示；保留原有审计、证据与费用记录，代码回滚无法撤销已发请求。

本地运行实例已验证；未 commit、push、部署或重启服务。其他聊天如缓存旧工具描述，应重新读取 research_read 或刷新连接，以实时 nextAction 为准。

最终验证：npm run check:fast 通过，1230 项测试全部通过，lint 0 error / 7 项现有 warning，TypeScript 通过；本次已跟踪修改文件的 git diff --check 通过。首次全量回归曾暴露 API fixture 未提供新配置存储及过早读取配置导致错误顺序变化，已将读取移至任务身份核验之后、隔离任务不读该配置，并补齐 mock；定向复验及重新运行 check:fast 均通过。未运行完整生产构建或部署检查，准备合码/发布时再执行。


## 五阶段研究积分修正（2026-11-08）

新任务默认不限任务调用次数，保留旧任务有限授权、账户次数余额及两次业务确认。研究服务费用统一以1研究积分=¥0.01换算，原始供应商单位和凭据保留，未知价格不作零费用。原有调用额度不换算为货币积分。具体接口、数据边界、规划估算、验证及回滚见 [Lili研究积分规则](lili-research-credits-2026-11-08.md)。本节为源码规则更新，不表示已更新已连接MCP服务或生产环境，也未修改真实账户余额。
