# Implementation Plan
## Summary
新增纯函数 handoff 契约、浏览器交接适配，沿现有六个 workbench 接线。服务端核验 Launch Approval，并更新原编排输出，PPC 引用原批准执行。
## Technical Context
Next.js 15 / React / TypeScript；不新增依赖、数据库表、worker 或生产配置。浏览器存储只作导航缓存。
## Constitution Check
AGENTS.md 最小改动、事实源不变、Orchestrator 最小权限、兼容旧交接。2026-10-25 用户已批准跨模块 P0 修改。
## Rollback
撤回本次文件；未改变数据库 schema。新 envelope 不授予写权限。旧版 session handoff 保留降级读取。
## Validation
契约/存储/审批纯函数与 API 边界测试；check:fast；隔离 UI 验证。合码前完整 check 与 diff --check；无服务器发布。

## 后续 Round B 证据桥接

沿用 storage adapter + FileObject，增加 Market 专用受限上传端点与 selection 证据加载器；不增加表、依赖、任务或 worker。Tool Adapter 按鉴权 route 的组织/工作区读取 fileId，并生成现有 Market 输出/Opportunity 交接。共有指标允许 null 保留未知；evidenceCompleteness 与商业机会分隔离，兼容旧数字报告。回滚关闭上传/工具入口并回退应用，保留历史 FileObject 和 Trace；不删除研究证据或 ProductRecord。详细操作、边界和验收见 docs/agent-chain-round-c.md。
