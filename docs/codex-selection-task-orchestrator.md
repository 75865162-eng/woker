# Codex 任务：选品任务编排器（Selection Task Orchestrator）V1

## 页面挂载（建议）
`src/app/agents/market/selection-task/page.tsx`（Market 下新「选品任务」入口；旁链现有 `/agents/market/selection` 证据表单与 `/agents/market`）

## 目标

新增统一的 **选品任务编排器**：用户配置 AI + 选品规则后，输入类目/关键词/Marketplace，**一键**按序跑完采集 → 差评/供应商证据 → AI 分析 → **确定性**利润计算 → 生成完整选品报告与待审核 SKU Draft；**人工审核确认后**再创建 ProductRecord / SKU。

V1 交付标准：**一键生成完整选品分析 + 待审核 SKU Draft**；默认不写库；仅在用户明确「确认建 SKU」且门禁通过后，才调用 Round I ERP CLI（`pnpm erp -- products upsert --file … --write`）写库。

## 非目标（本轮禁止）

- 不绕过 Amazon / 1688 登录墙、验证码；不加隐身爬虫 / 打码
- **禁止再向用户要 Cookie**；禁止把 Amazon / ERP 账号密码或 Cookie 传给大模型或写入 prompt / 日志 / draft
- AI Key、DATABASE_URL、服务身份仅服务端 / 受控 CLI / `.env`；大模型只接收任务参数与脱敏结果
- 不让大模型编造售价、采购价、费用、利润数字；缺失一律显示 **「未知」**，不补假数
- 不默认自动写库；不默认跑完整 `npm run check` / E2E / 生产构建 / 真实外网全量采集
- 不重写 selection-pipeline 采集内核、不重写 `saveProductAggregate`、不新增与 Round I 平行的第二套写库路径
- 无 Cookie 传图可列为后续；V1 写库时图缺失只提示 `IMAGES_NEED_UPLOAD` / 「图片需后续上传」

## 仓库现状（必须复用，先 skim 再改）

仓库根：`/Users/chenjieliang/Documents/amazon ad bulk operation`

| 能力 | 位置 |
| --- | --- |
| AI Provider / Base URL / Model | `/settings` + `src/app/api/ai-settings`、`src/lib/server/user-ai-settings.ts`、`src/lib/server/ai-runtime.ts`（Listing AI 已用） |
| 选品采集 / tag / suppliers / workbook / quality | `scripts/selection-pipeline/`（`npm run selection:*`） |
| 证据网页表单 | `/agents/market/selection` → `selection-evidence-form-workbench.tsx` + `api/agents/market/selection-*` |
| Market 机会三步 | `market-agent-workbench.tsx` + `selection-evidence` 上传 draft |
| ERP 无 Cookie 写库（Round I） | `scripts/erp-cli/`：`pnpm erp -- products upsert --file draft.json [--write]`；`products get --sku …`；env：`ERP_*` 兼容 `SELECTION_*` |
| 商品聚合 / 审计 / revision / Outbox | 现有 `saveProductAggregate` 等（erp-cli 已复用） |
| 风险分级验证 | `AGENTS.md`「最小化处理和验证路线」 |

必读（skim）：`scripts/selection-pipeline/README.md`、`docs/selection-round-d.md`、`scripts/erp-cli/README.md`、`AGENTS.md` 相关段、现有 market selection API。

## 架构

```
配置 AI + 选品规则
  ↓
输入 类目 / 关键词 / Marketplace（+ 价格区间、阈值、费率）
  ↓
编排器：collect →（证据：采集或表单/文件兜底）→ tag / suppliers → workbook
  ↓
AI：差评归类、机会点、改进方案（只吃已落盘的评论/竞品文本；不吃密钥）
  ↓
确定性代码：价格 / 成本 / 利润 / 利润率 / 盈亏平衡（显式输入；缺则「未知」）
  ↓
生成选品报告 + SKU Draft（待审核；默认 dry-run 形状）
  ↓
人工审核（门禁清单）
  ↓
确认后：erp upsert --write → ProductRecord / SKU
```

实现建议：

1. **编排核心**：`scripts/selection-task/` 或 `scripts/selection-pipeline/src/orchestrate-task.ts`（优先函数复用，避免 shell 拼接；若调 CLI 仅固定 argv、本机、无密钥进 prompt）
2. **任务状态**：本地 `selections/{slug}/task/`（或等价）存 `task.json`、`report.json`、`profit.json`、`review-table.json`、`erp-draft.json`、`gate.json`；不把研究数据提交 git
3. **Web**：新页 + API 创建/轮询任务、展示报告、触发「确认建 SKU」
4. **写库**：仅服务端 / CLI Broker 调 `pnpm erp -- products upsert --file <erp-draft.json> --write`；先 dry-run 再 write；适配 selection `draft` 嵌套 → erp-cli 扁平 schema（未知字段拒绝，按 Round I）

## 数据模型草图

### SelectionTaskConfig（任务入参）

- `marketplace`（如 `US`）
- `keyword` / `category`（可选）
- `priceRangeMin` / `priceRangeMax`（可选）
- `minMarginRate`（最低利润率阈值）
- `minReviewCount`（最低评论数过滤）
- `maxBsr`（最大 BSR）
- `purchasePriceSource`：`manual` | `supplier_median` | `unknown`
- 物流与平台费率（显式，可空）：见利润输入
- `autoGenerateSkuDraft`: boolean（默认 true）
- `allowAutoWriteAfterApprove`: boolean（V1 默认 false；即使 true 也必须先过人工确认动作）

### ProfitInputs（显式；缺省 = 未知，禁止 AI 填）

- 售价 `sellingPrice`
- 采购价 `purchasePrice`
- 头程物流 `inboundFreight`
- FBA 费用 `fbaFee`
- Amazon 佣金 `referralFee`（或费率 + 由售价推算，推算须在代码侧且输入完整）
- 广告费率 `adRate`（或预计广告费）
- 包装及其他成本 `packagingOther`
- 币种 `currency`（如 `USD`；采购为 CNY 时须有汇率输入或标记未知，**禁止静默假汇率**）

### ProfitOutputs（仅代码计算）

- 销售额 `revenue`（通常 = 售价；多件另议，V1 按单件）
- 单位总成本 `unitTotalCost`
- 单位利润 `unitProfit`
- 利润率 `marginRate`
- 盈亏平衡售价 `breakEvenPrice`

任一必需输入为未知 → 对应输出为 **「未知」**，不得用 0 假装算过。

### 差评与改进表（报告必有；列固定）

| 差评问题 | 原文证据 | 出现次数 | 严重程度 | 产品改进方案 | 验证方式 |
| --- | --- | --- | --- | --- | --- |

- 「差评问题 / 原文证据 / 出现次数」：优先来自 `selection:tag` 与真实/已导入评论；AI 可归类与合并标签，但原文必须可追溯到已存评论
- 「产品改进方案 / 验证方式」：AI 建议；须标注 `source=ai`
- 无评论证据时：表可空或仅 NEEDS_DATA 说明；**禁止编造原文**

### 选品报告 + SKU Draft

报告至少含：竞品摘要、价格带、差评改进表、供应商短名单、利润表、门禁结果、未知字段清单。  
SKU Draft：对齐 erp-cli upsert schema 的 `erp-draft.json`（含 `workbookDetail` 嵌入价格/利润/差评/改进）；`sku` 可为 `DRAFT` 直至写库注入正式 SKU。

## UI 入口

- **新路由**：`/agents/market/selection-task`
- **组件**：`src/components/agents/selection-task-workbench.tsx`（client）
- AppShell 标题：`选品任务`；副标题：`一键生成分析与待审核 SKU；确认后再写库`
- 从 `/agents/market`、`/agents/market/selection` 加入口链接
- 中文 UI；设置页只读展示「AI 已配置 / 未配置」，不回显 Key

### 页面区块

1. **任务配置**：Marketplace、关键词、类目、价格区间、最低利润率、最低评论数、最大 BSR、采购价来源、费率与成本输入、是否生成 Draft、是否允许审核后写库（默认关）
2. **运行**：一键开始；步骤进度（collect / evidence / AI / profit / report / draft）
3. **报告**：利润表、差评改进表、供应商、未知项高亮
4. **审核与写库**：门禁清单勾选；`确认创建 SKU` 仅门禁全过且权限足够时可点；默认先 dry-run 结果展示，再 write

## API（建议，权限 `requireApiPermission("agents", …)` + workspace）

- `POST /api/agents/market/selection-tasks` — 创建任务并启动编排（返回 taskId / slug）
- `GET  /api/agents/market/selection-tasks/:id` — 状态、步骤、报告摘要
- `GET  /api/agents/market/selection-tasks/:id/report` — 完整报告 JSON
- `POST /api/agents/market/selection-tasks/:id/approve-create` — 人工确认后 dry-run 或 `--write`（body 明确 `write: true`）；服务端再跑门禁
- 复用现有 `selection-reviews` / `selection-suppliers` / `selection-local` 作证据兜底，不必重复造轮子

路径安全：slug 无 `..`；任务目录锁（对齐 `.pipeline.lock`）；中文错误文案。

## 利润公式（确定性代码；写进单测）

定义（单件、同币种已对齐时）：

- `referralCost = sellingPrice * referralRate`（若输入为佣金金额则直接用金额）
- `adCost = sellingPrice * adRate`（若输入为广告费金额则直接用）
- `unitTotalCost = purchasePrice + inboundFreight + fbaFee + referralCost + adCost + packagingOther`
- `revenue = sellingPrice`
- `unitProfit = revenue - unitTotalCost`
- `marginRate = unitProfit / revenue`（revenue 未知或 0 → 利润率未知）
- `breakEvenPrice`：在费率随售价变化时，用代码求解使 `unitProfit = 0` 的售价；若费率结构导致无闭式解，用文档约定的迭代并单测；输入不足 → **未知**

禁止：LLM 直接输出利润数字作为权威结果；AI 最多解释公式，数字以代码为准。

## AI vs 代码边界

| 职责 | 执行方 |
| --- | --- |
| 竞品/评论/供应商采集与落盘、quality 门禁、workbook | 现有 selection-pipeline / 表单 API |
| 差评归类、机会点、改进方案、验证方式文案 | AI（只读已落盘文本；失败则跳过 AI 段，报告仍可出「未知/待补」） |
| 售价/成本/利润/盈亏平衡 | **仅代码** |
| draft → erp schema、upsert dry-run/write、权限与重复 SKU | erp-cli + 服务端门禁 |
| Cookie / 密码 / AI Key / DB URL | 永不进模型上下文 |

## 写库前门禁（全部满足才允许 `--write`）

1. 评论与供应商证据完整（沿用 Round D / quality：有效低星评论与标签、≥3 条真实结构合法 1688；fixture / 纯测试包默认禁止写库或显式 `allowTestWrite` 且 UI 标红）
2. 采购价与售价**来源明确**（非未知）；来源字段写入 draft meta
3. 利润率 ≥ 任务配置的 `minMarginRate`（利润率未知 → 不通过）
4. 图片：无 fileId 时仅提示「需后续上传」，不阻塞 V1 写库（与 Round I `IMAGES_NEED_UPLOAD` 一致），但必须在审核页可见
5. 无重复 SKU（`products get` / DB 查重）
6. 当前用户具备 `products:create`（及 erp-cli 组织成员 active 校验）

## 验收标准

- 打开 `/agents/market/selection-task`，填写关键词等配置，一键后得到：竞品摘要、差评改进表（六列）、利润表、供应商、未知清单、待审核 erp-draft
- 故意留空采购价 → 利润相关为「未知」，AI 不得填假价
- AI 未配置时：采集+利润+报告骨架仍可跑，分析段降级提示「未配置 AI」
- 默认不写库；点确认且门禁通过 → dry-run 成功；再 `--write` 后可用 `products get` / dashboard 见到 SKU
- 全程无 Cookie 提示；日志/prompt 无密钥
- Market / 证据页有入口；短文档说明 V1 流程（可写 `docs/selection-task-orchestrator.md`）

## 验证（按 AGENTS.md 分级）

1. 利润公式与门禁纯函数单测；erp draft 适配单测（未知字段拒绝）
2. `npm run check:fast`
3. 相关：`npm run test:selection`、erp-cli 已有测试若触及则跑；不默认全量 check / E2E / 真实外网采集 / 真实 write（本地 write 仅在用户/任务明确要求且 env 就绪时）
4. 最终回复：改动文件列表、如何点一遍 UI、跑了哪些命令、未跑的高成本验证及触发条件

## 交付物

- 编排 CLI 或可调用模块 + Web 页 + API
- 报告 JSON / 表结构（含六列差评改进表 + 利润表）
- 与 `pnpm erp -- products upsert` 对接的待审核 draft 与确认写库路径
- 简明文档与入口链接
- 不提交 `selections/` 研究数据、`.env` 秘密、Cookie
