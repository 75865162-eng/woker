# Round D：直播选品可运营门禁与真实证据验收

本轮复用 Round B 本地 CLI、Round C Tool Gateway/交接与 Launch/PPC 闸门。只做采集质量门禁、人工补数据、受控图片上传续作和 Market 证据语义；不新增后台采集、worker、权限、数据库表、广告执行或上架动作。

## 问题与验收口径

业务缺口是“阶段跑完”容易被误当作“证据足够”：评论登录墙、1688 风控仍可留下空 tags/suppliers。D1 先阻止缺证据写库；D3 明确导入、估算和模拟边界；D2 提供授权操作手册；D4 区分隔离测试、真实产物验证、真人页面验收。

现状基于本机 `selections/kayak-cockpit-cover/`（2026-10-25）：1 个真实竞品、1 张可读本地图片，validReviews=0、taggedQuotes=0、suppliers=0、uploadedImages=0，价格缺失；quality.status=NEEDS_DATA、needsReview=true、blockWrite=true。历史原码 SITE_BLOCKED_OR_LOGIN_REQUIRED / SITE_CIRCUIT_OPEN 保留。没有 created.json，也没有正式 SKU 创建或真实上传成功记录。

## D1：硬门禁与人工兜底

`src/quality.ts` 的纯判定 + 文件核验在 workbook 和 create 复用；`productsCreate` 在数据库模块导入前再次核验。旧 quality.json 不是授权凭证。

| 检查 | 门槛与行为 |
| --- | --- |
| 来源 | fixture/已知离线供应商禁止写库；缺 collection-info 来源也阻断 |
| 评论 | 当前竞品 ASIN、整数 1–3 星、原文非空且 ≤240 字、日期字符串；ASIN+原文去重，至少 1 条 |
| 标签 | 引用必须与原始有效评论匹配；按 ASIN/标签/引用去重，至少 1 条；空值为 TAGS_NEEDS_DATA |
| 供应 | HTTPS detail.1688.com 商品 URL，去掉 query 后去重，至少 3 条；不凭空补报价、MOQ、工厂名 |
| 本地图片 | 当前竞品的 raw/images 相对路径、真实文件、非空、≤10MB、可读取图片元信息；阻止越界与外部符号链接 |
| 上传 | 启用上传时记录 requireUploadedImages=true；当前本地图片须有同工作区上传标识和匹配 asset，缺失/部分失败不能写库 |
| 写入 | blockWrite=true 时 create --write / run --write 非 0 失败；指出评论/标签/供应/图片兜底路径，不进入 Product 聚合 |

quality 还记录 missingMetrics、collectionReasonCodes、needsReview、blockWrite。门槛齐全为 READY_FOR_REVIEW，未代表市场机会、商品合规或采购核验完成；缺价格等指标仍需复核。历史登录墙不删除，但人工补齐后历史错误不会永久阻断当前完整证据。

人工操作（格式和完整授权步骤见 [CLI README](../scripts/selection-pipeline/README.md#round-d-质量门禁与人工评论)）：

```bash
npm run selection:tag -- --slug kayak-cockpit-cover --reviews-file /absolute/path/reviews.jsonl
npm run selection:suppliers -- --slug kayak-cockpit-cover --suppliers-file /absolute/path/suppliers.json
npm run selection:workbook -- --slug kayak-cockpit-cover
```

导入评论会先验证全部输入，再按涉及 ASIN 替换 raw/reviews/<ASIN>.jsonl；其他 ASIN 不变。只有匹配的真实低星原文才能产生有效标签；词典未命中要人工补类目词典，不捏造评论。至少 3 条不同真实 1688 商品线索再审查资质；离线 fixtures 不能采购，也禁止正式写库。门禁只能检查格式、引用和完整度，人工来源真实性仍须核对。

## D3：Market 与 Round C 边界

Market 页内联三步：本机完成 slug → 上传 derived/draft.json 取得当前工作区 fileId → 点击生成机会。工具缺 fileId 时维持清晰 NOT_IMPLEMENTED；只读已上传研究切片，不在 Next 请求内 spawn CLI/Playwright、不自动创建商品。

- `sales30Days` 在 draft 和 Market 证据中携带 heuristic=true / uncalibrated_bsr_power_law；即使输入伪称 heuristic=false，也强制按估算处理。Market estimatedDemand 等未观测信号仍 null；不把 BSR 估算传成真实需求。
- 标签为空或供应线索不足 3 条时明确 NEEDS_DATA，不可标为直播验收通过。上传文件不等于核验其真实性或本地图片、正式报价已完成。
- 无 Round B 证据的普通报告显示“模拟数据不可作为全链路验收”；保留旧研究/交接能力，不引入新的“已验收”布尔标记。
- Supplier 的现有 Round B 分支继续保留来源和未知报价，空短名单 NEEDS_DATA，UI 禁止交接 Listing；来源非法不回退模拟工厂。本轮只补测试，不改 Supplier 或 handoff.ts。
- Launch 与 PPC 继续使用既有服务端 Approval 核验；伪造 launchApproved 无效。未增加 Ads/SP-API 写工具。

## D2：受控图片上传与正式建 SKU

[最短授权步骤](../scripts/selection-pipeline/README.md#授权上传与建-sku-最短步骤) 写明 Cookie 获取、隐藏输入、变量和 `/dashboard` 核验。

必备三个写库变量：DATABASE_URL、SELECTION_ORGANIZATION_ID、SELECTION_ACTOR_USER_ID。操作者须为目标组织 active owner/database_admin；上传另需 SELECTION_ERP_URL、SELECTION_ERP_COOKIE，使用同组织/工作区且有 products:edit 的登录会话。Cookie 不进代码、日志、截图或文档。

```bash
# 先人工完成研究证据并核对 quality，再补传本地图片；不重新爬站。
npm run selection:workbook -- --slug kayak-cockpit-cover --upload-images --workspace-id default
# 质量、上传和作用域核对后明确建 SKU。
npm run selection:create -- --slug kayak-cockpit-cover --write --workspace-id default
```

上传走 POST /api/products/file-assets/upload。创建直连 Prisma → saveProductAggregate，非 POST /api/products；沿用事务、revision、审计、Outbox、投影和草稿幂等。create --write --upload-images 也可先核对研究证据再补传后写库。仅 --write 不隐式上传。失败保留真实附件和本地证据供续作，不自动删正式记录或附件。

成功收据 created.json：sku/productId/revision/outboxEventId/projectionEventId/queuePending/slug/workspaceId/createdAt/uploadedImageFileIds；幂等重跑事件 ID 可为空。queuePending=true 需要恢复 Outbox；不能只看文件存在就判定新商品列表已可见。到同组织/工作区 `/dashboard` 打开收据 SKU，核对商品名、竞品图附件、供应线索和工作簿。正式误创建需走 ERP 审核/取消流程，不自动删主档或审计。

**本轮真实阻塞**：只检测变量是否存在、不展示值；本机 .env 有 DATABASE_URL，但缺显式选品组织/操作者和 ERP URL/Cookie。真实评论与供应商也未补齐。实际 create --write 在质量门禁失败，未接触目标数据库；没有真实图片上传、SKU、created.json 或真人登录后的 dashboard 可见性验收。未从其他任务借会话或自行挑管理员，也未使用 fixture 绕过。

## D4：验证记录与 PR 验收清单

- [x] 真实 kayak 目录 tags=0/suppliers=0 → blockWrite=true；create --write 非 0 并指出 reviews-file / suppliers-file 路径。
- [x] 人工 reviews/suppliers、Cookie 上传、--write 权限步骤与 ToS/限速提醒已文档化。
- [x] 销量估算携带 heuristic 标记；Market 未将其当真实销量/需求。
- [x] Market 引导上传，缺 fileId 明确失败；空供应名单不回退模拟候选。
- [x] 真实上传+建 SKU 未完成，已记录证据缺口及身份/Cookie 阻塞，没有伪造收据。
- [x] 选品单测、证据/API、隔离数据库与浏览器回归通过（见下方命令与统计）。
- [x] 本轮提交仅 allowlist；共享工作区其他 Sellfox/Prisma 改动不暂存、不提交、不修改。
- [ ] 由操作者补齐真实证据和授权后，真人走 Market→Product→Supplier，并在 dashboard 核对真实上传与 SKU。此项不能用自动测试或隔离数据库代签。

验证层次：

1. 13 项选品测试：原 DOM/配额/上传契约，加质量引用/阈值/去重/fixture 拒绝，以及模拟直播 CLI 的手工文件续作/上传失败状态。模拟直播只测试本地门禁，不向现有数据库 write。
2. 6 项 selection-evidence/API 测试：来源/权限/文件限制，加估算强制标记、缺证据报告语义及 Supplier 空名单/非法来源拒绝。
3. 7 项 create 集成测试：随机命名、loopback/tmpfs 的独立 PostgreSQL，验证门禁达标测试资料后的聚合、幂等、权限、跨组织附件回滚、Outbox。它们不是 fixture 正式写库，也不证明真实 ERP 已成功。
4. 6 项隔离 Agent 浏览器：原六段、Launch/PPC blocked 与来源交接保持，增加模拟不可验收提示。没有真实登录会话。
5. 本机真实 kayak draft 只读映射并经过现有 Product/Supplier Runtime：1 个竞品证据，Supplier NEEDS_DATA、候选 0，未回退模拟工厂。Product 仍使用现有模拟 adapter；本次仅核对真实证据传递。没有上传文件、持久化 execution 或真人 UI 操作，内部本地来源引用不冒充服务端 fileId。

```bash
npm run test:selection
npx tsx --test tests/selection-evidence.test.ts tests/selection-evidence-api.test.ts
npm run test:selection:create
npx playwright test --config tests/browser/agent-chain.config.ts
npm run check:fast
```

回滚只撤销本轮 allowlist 的代码/文档，保留原始研究资料、已上传资产和已有正式商品；不得为恢复旧流程而将缺证据写库当作可用替代。无生产部署、数据库迁移或后台采集变更。请求次数、站点串行限速、配额和登录/验证码不绕过规则沿用 Round B；版权与目标站点 ToS/robots 限制见 README。

### 最终校验范围

- `npm run check:fast` 在执行时通过 254 项核心测试、ESLint 和 TypeScript；选品测试最后复核为 13/13，另有证据/API 6/6、临时库 7/7、Agent 浏览器 6/6。最后的上传要求续作修正和图片数量去重复核已包含在选品测试中。
- 共享工作区后来持续出现并行 Sellfox UI 改动，单独构建在 resource-table.tsx:29 的 title 类型处失败；按 allowlist 未修改该文件。更早一次构建与临时库测试同时运行，虽退出 0 但出现临时目录清理后的 tracing ENOENT 告警，不能作为无告警构建证据。
- 最终基于已提交 `2c90f5f` 加本轮 allowlist 文件建立临时隔离校验目录，不读取 .env、不包含并行未提交 Sellfox/Prisma 改动。该快照 254 项核心测试与完整 Next 生产构建均通过；只保留既有 Product hook dependency warning，无 tracing 文件复制告警。未改构建配置或依赖版本。等价采用已完成测试 + 单独构建，未机械重跑 npm run check 的同一测试集。
- 以上只证明本轮 allowlist 快照；不宣称仍在修改中的整个共享工作区已完成生产验收。没有服务器、真实站点采集或现有数据库写入。
