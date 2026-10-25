# Round C P0 Validation — 2026-10-25

## 全改动区收尾结果

用户确认将 Agent Round C、Round B CLI、赛狐窄表/租约、Prisma 与依赖改动整体验证并同步 GitHub。代码整体提交为 `b6774be`；本记录补充该提交的验证结果。服务器发布不在本次范围。

- `npm run check`：通过，包含 232 项核心测试、全局 ESLint 和 Next.js 生产构建。ESLint 无错误；商品工作台既有 `openProduct` hook dependency warning 保留，未扩展为无关重构。
- `npm run typecheck`：通过。
- Agent 隔离浏览器：3/3 通过。真实六个工作台 + Runtime 完成编排→Market→Product→Supplier→Listing→Launch 批准→PPC；无广告历史仍能出建议；Orchestrator 显示每段 execution 下钻链接；未来版本/跨工作区/未批准被拦截；切工作区丢弃迟到执行。
- 赛狐隔离浏览器：6/6 通过，覆盖列表、导出、按需详情、切域、工作区迟到响应和窄表导出。
- `npm run test:selection`：9/9 通过，覆盖 HTML 解析、标签、SQLite 配额、熔断、1688、ERP workbook 与写库拒绝。
- `npm run test:selection:create`：临时 PostgreSQL 7/7 通过，覆盖聚合创建、幂等、独立进程并发 SKU、权限拒绝、跨组织附件回滚、Outbox 恢复。测试结束删除独立容器，不使用既有数据库。
- 并行任务收尾新增附件引用用例后，另行运行 `tests/product-consistency.test.ts`：2/2 通过。
- Prisma validate：通过。临时库先执行 HEAD 原基线的全部迁移，再执行两条新增迁移，均成功。迁移数据库与 schema 的 diff 与原 `2d2794f` 基线逐字一致；存在历史索引命名、默认值和约束漂移，本次未自动修复，也未宣称全库零漂移。
- `git diff --check`：通过。

先前 3 项赛狐回归失败已修复；Git 忽略的 `tmp/` 临时文件已按目录边界排除 ESLint。先前失败快照不再作为当前检查结论。生产构建与浏览器回归均已实际完成；不再以本机临时依赖变化推断检查状态。

## 适用限制

- 本轮收尾未访问真实 SellerSprite、Amazon/1688、AI、生产数据库或服务器；浏览器使用隔离接口。其他并行任务的真实赛狐验收见 `docs/sellfox-agent-read.md`，不可混同为本轮浏览器的证据。
- 此处为 P0 初始验收快照：当时 Round B 仅有挂点。后续已实现受控产物上传与 Opportunity 证据映射，见下方补充；后台实时采集 runner/job 仍未接入。
- 部分既有业务 Agent 仍有模拟适配器；通过接线回归不代表真实研究、文案生成、采购、上架或广告执行验收。
- Orchestrator 无业务写权限；不增加顺序执行 P0+、自动建 SKU、真实上架或广告 transport。SKU 正式资料继续使用现有 Product 聚合与 /dashboard。
- Launch 入站审批仅解锁 PPC 建议，广告执行需要独立审批；独立 PPC 诊断入口保留。
- 未部署服务器、未运行生产迁移、未合并 main。未来发布应人工审核本次迁移及历史漂移，再走现有 CI artifact 流程。

## 可复现命令

```bash
npm run check
npm run typecheck
npx playwright test --config tests/browser/agent-chain.config.ts
npm run test:sellfox:browser
npm run test:selection
npm run test:selection:create
npx tsx --test tests/product-consistency.test.ts
npx prisma validate
git diff --check
```

迁移检查只使用随机命名、loopback 端口、tmpfs 存储的独立 PostgreSQL 容器；以原提交 schema/迁移和当前 schema/迁移分别对比，不连接既有数据库。全改动区盘点见 workspace-inventory.txt。

## Round B 证据桥接补充验收

- `npm run check` 再次通过：238 项核心测试、ESLint、Next.js 生产构建。仅保留商品工作台原有 hook dependency warning；`npm run typecheck` 通过。
- Agent 浏览器 5/5 通过：原六段链与审批不回退，新增上传→生成真实结构报告→带 null 指标交接 Product，以及切工作区丢弃迟到上传。迟到上传用例后来修正为实际 workspace 事件，并针对新事件复核；不要求新工作区保留旧请求的瞬时错误文本。
- 证据上传/API/Runtime 4/4 定向用例通过，额外覆盖 viewer/未登录拒绝、有无 Content-Length 的超限拒绝、规范化丢弃产品字段、失败清理和读取前跨组织/工作区拒绝。
- 本机已有 `selections/kayak-cockpit-cover/derived/draft.json` 只读映射成功：1 个竞品→1 个证据机会，字段完整度 75，商业机会分 null；不上传、不写现有数据库、不访问外网。该草稿真实差评/供应商缺口仍沿用 Round B 说明。
- 本轮使用受控上传文件作为输入，真实性仍需人审；fixture=false 是来源声明，不是可信认证。未观测的需求/竞争/趋势/利润/风险保留 null；字段覆盖率绝不作为商业机会分。
- 无 Prisma、依赖、队列、worker、部署配置改动；未运行生产数据库或服务器操作。自动实时采集、Supplier 真实消费和业务写入未在此轮实现。
- 并行任务在共享工作区提交 `b48850e`，包含本轮证据桥接代码及其赛狐/选品修改；收尾在此基础上同步全部未提交变更。

命令补充：`npx tsx --test tests/selection-evidence-api.test.ts tests/selection-evidence.test.ts`；浏览器继续使用原 agent-chain 配置。后续发布与真实接口验收需独立执行，本轮未部署。

收尾共享工作区新增赛狐补数脚本/计划函数/测试，随整区提交 `95f6c23` 纳入；补充3/3计划测试、相关ESLint与全库TypeScript均通过。脚本后续仅调整错误脱敏与延迟创建队列的清理逻辑；未运行补数脚本、未创建任务或触发采集。上述238项全量测试结果不包含这3项后加入的测试，单独报告，避免混用统计。


## Supplier 证据接线补充验收（2026-10-25）

- `npm run check:fast` 通过：当时 249 项核心测试、全库 ESLint（仅既有 Product hook warning）、TypeScript。随后新增“不同来源工具输出禁止回退”用例，与供应证据其余用例单独复核，6/6 通过。
- `npm run build` 通过生产构建。最后补充 SHA256 格式校验、证据 toolCallId 和空短名单 handler 防护后，另做定向测试、类型与 lint 复核。
- Agent 浏览器：原 5 项通过；第 6 项空短名单用例初次因摘要出现两处而发生 locator 严格匹配失败，改为精确摘要匹配后通过。覆盖 Round B→Market→Product→Supplier→Listing 的实际工作台、原六段/审批链与空短名单禁用交接。
- 证据路径保留原始页面价/MOQ、不猜联系人/交期/成本/评分；来源/URL 无效、工具失败、返回来源不匹配均停止；空短名单为 NEEDS_DATA。报告证据携带原文件标识/hash/导入时间与工具调用标识。
- 仍为人工提供、未经独立核实的供应线索；无实时采集、正式询价或采购动作。Product 与 Listing 原模拟适配器未在本轮替换，页面回归不代表真实 PRD 成本或刊登文案质量验收。未修改数据库结构、生产或服务器。
- 并行赛狐改动独立保留，GitHub 同步范围等待用户明确选择；不把并行工作冒充本轮已完成功能。
