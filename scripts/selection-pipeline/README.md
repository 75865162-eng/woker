# Amazon US 选品流水线

独立的本地 TypeScript CLI：规则 → Playwright Amazon US → 低星短评词典 → 1688 短名单 → ERP 格式 workbook / thin draft。默认仅写本地文件。无付费选品、代理或数据 SaaS；没有验证码破解、隐身插件或自动登录。仅支持 amazon.com / US。

## 安装与运行

沿用仓库 npm + package-lock / tsx，不另建子 package。Node.js 20+；安装开发依赖（Playwright、tsx、yaml）和 Chromium。快照使用系统 `sqlite3` CLI ≥3.35，不改变 Prisma schema。

```bash
npm ci
npx playwright install chromium
# Linux 初次安装浏览器系统库可用 npx playwright install --with-deps chromium
# 缺少 sqlite3 时：macOS brew install sqlite；Ubuntu sudo apt-get install sqlite3

npm run selection:run -- --keyword "kayak cockpit cover" --slug kayak-cockpit-cover
npm run selection:run -- --keyword "kayak cockpit cover" --slug kayak-cockpit-cover --write
npm run selection:tag -- --slug kayak-cockpit-cover --cloud-patch
```

安装 pnpm 的环境也可 `pnpm selection:run -- --keyword ... --slug ...`；以 npm lockfile 为依赖事实源，不生成另一份锁文件。命令中的第二个 `--` 会被 CLI 正确处理。

`--write` 需要下方明确的数据库和操作者配置。**不要在未审查草稿时运行写库命令。** 模块不自动读取 `.env`；需要时沿用仓库风格：

```bash
node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/selection-pipeline/src/cli.ts create --slug kayak-cockpit-cover --write
```

## 规则与分步续作

复制 `rulepack.example.yaml` 后用 `--config /path/rules.yaml` 指定。`keywords` 合并 CLI keyword；可选 `bestsellersUrl` 仅接受 HTTPS www.amazon.com。搜索/PDP 会依次按 negatives / bannedTerms、价格、评论数、BSR 过滤。缺失指标保留 null，**不视为已通过数值门槛**，在 `derived/quality.json` 列出，须人工复核。

并发目前固定为 1；配置 `concurrency: 1`。间隔默认 3000ms、最小 1000ms；UTC 日配额在 `scripts/selection-pipeline/data/selection.sqlite` 持久化，跨 slug / 进程共用，失败的请求也消耗配额。SQLite 文件应保留，删除会重置配额。不要并行启动多个采集 CLI；单进程串行，不提供跨进程网络并发调度。

Amazon 只读取服务端 HTML，屏蔽子资源；1688 允许必要的脚本/XHR/fetch（限定 1688/alibaba/alicdn 域），也计入配额并排队限速，屏蔽图片/字体等资源。日配额指受控页面导航、允许的动态资源及竞品图片下载；浏览器重定向等底层网络行为不作为独立页面计数。图片上传是独立 ERP 请求。遇到验证码、登录墙、403/429/503，当前站点熔断，不循环重试；可在另一次人工操作后重新运行。Amazon 评论登录墙也会关闭该次后续 Amazon 请求。

```bash
npm run selection:collect -- --slug kayak-cockpit-cover --keyword "kayak cockpit cover"
npm run selection:tag -- --slug kayak-cockpit-cover
npm run selection:suppliers -- --slug kayak-cockpit-cover --suppliers-file /absolute/path/suppliers.json
npm run selection:workbook -- --slug kayak-cockpit-cover
npm run selection:create -- --slug kayak-cockpit-cover --write --workspace-id default
```

编辑 `selections/{slug}/brief.json` 可补充 chineseName / englishName / priceMin / priceMax / solutionKeywords。后两项价带用于草稿目标；采集过滤以 rulepack 为准。1688 优先使用中文 `solutionKeywords`，缺省使用原 keyword。`--dictionary /path/category.yaml` 使用类目词典（复制通用词典后扩展）。单个 ASIN 详情失败会跳过；评论/图片失败保留该竞品并记日志。`maxReviewsPerAsin` 上限 1000，但一期最多读 10 页，受实际页面和配额限制。评论仅 1–3 星，每条最多 240 字符。

同一 slug 同时只能有一个命令。异常强杀可能留下 `.pipeline.lock`：先确认没有运行中的 CLI，再手动移除该文件。不同关键词或 fixture/live 必须使用不同 slug；不覆盖已存在的 brief keyword。重新 collect 会更新当前竞品列表，历史图片文件可能保留；以 `competitors.json` 为本次清单。

每阶段 stdout 是结构化 JSON 日志；单条失败在 `raw/errors.log`（追加历史；含 UTC 时间、阶段、ASIN、错误码，不含密钥/响应体）。搜索无结果会保存最多 2MB 的 `raw/search-empty.html` 供本机诊断。退出码：0=命令执行完毕（仍需看 quality 与 errors）、1=参数/运行故障、2=collect/run 没采到竞品；空表也会保留以便续作。浏览器不可启动时先检查 Chromium 安装。

## 产物与数据含义

```text
selections/{slug}/
  brief.json
  run-info.json
  raw/collection-info.json       # fixture/live 来源，以此为准
  raw/competitors.json
  raw/reviews/{asin}.jsonl
  raw/images/{asin}.jpg
  raw/errors.log
  derived/tags.json
  derived/suppliers.json
  derived/draft.json
  derived/workbook.xlsx
  derived/quality.json
  derived/created.json           # 仅 --write 成功后
```

Workbook 直接调用 `src/lib/products/product-export-job.ts` 的 `buildProductExportWorkbook`，保留其定价/竞品/供应商/改进/关键词表头和公式；另附“基础信息”“采集来源与标签”，记录 ASIN、URL、抓取时间、BSR、fileId/相对本地路径、标签数量。不要把新工作簿直接当成已经核准的正式商品。

`draft.json` 含 `schemaVersion: 1`、brief、competitors、suppliers、tags，以及可以交给聚合保存的 Product + workbookDetail。商品 ASIN 留空，竞品 ASIN 放 competitorAsins；竞品图放 workbookDetail.competitors，避免冒充自有商品主图。定价/尺寸/采购成本尚未核实时是占位；ERP 导出器的默认公式和默认汇率也须复核。

标签以“一个 ASIN 的一条去重短句命中某标签”为计数单位，可多标签；没有评论时计数为空，不能据此判断没有差评。`sales30Days` 为自编未校准的幂律启发式 `round(100000 / bsr^0.75)`，不是 Amazon 真实销量，不是 Keepa 或其他付费数据，也未按类目校准。BSR 缺失时销量未知。不同类目 BSR 不可直接比较。

SQLite 表 `asin_snapshots(asin,capturedAt,price,bsr,reviewsCount,rating)` 仅保留采集快照；不是商品主档事实源。所有运行数据、下载图片和 sqlite 均被 gitignore，不提交研究数据和 cookies。

## 图片上传

已找到并接入真实上传契约：`uploadProductImageAsset` → `POST /api/products/file-assets/upload`。Node CLI 显式提供 ERP origin 和当前登录 session cookie；使用同一组织/工作区的会话。凭据仅从进程环境读取，禁止写进 brief/rulepack/仓库或日志。

- `SELECTION_ERP_URL`：ERP 的 HTTPS origin（本机 localhost/127.0.0.1 允许 HTTP）。
- `SELECTION_ERP_COOKIE`：已登录用户的完整 Cookie header；API 仍检查 `products:edit`，只有 `products:create` 的会话不能上传。
- `--upload-images`：collect/run 时显式上传；`--write` 也会尝试上传。
- `--workspace-id`：缺省 default；上传的作用域必须与创建一致。

图片先下载并转成实际 JPEG（最多 10MB 输入/2500 万像素），成功上传才写 `competitors[].imageFileId` 和完整 `imageAsset`，再映射 hotVariantImageAsset。商品聚合保存现在会对旧主图字段 `imageFileId` 与嵌套 `imageAssets` 一并做 organization/workspace 归属校验。没有配置凭据/上传失败就保留本地文件，绝不伪造 fileId。默认不上传，避免文件模式产生服务端写入。仅 workbook 重建不会重新上传；如需补传请带 `--upload-images` 重新 collect。上传后暂未创建商品的临时附件由既有 ERP 生命周期管理，不在 CLI 自动删除。

## 可选云端补漏

默认关闭。只有 `--cloud-patch` 且存在 `SELECTION_CLOUD_PATCH_CMD` 才执行；不绑定任何厂商。命令变量为 **JSON argv 数组**，例如 `["python3","/absolute/path/patch.py"]`，不经 shell，不支持管道。可在自有脚本内部接自建 HTTP hook；本模块不会自动调用或配置付费服务。

stdin 为最多 50 条词典未命中短句：`[{"asin":"B012345678","quote":"original sentence"}]`。stdout 必须严格为 `[{"asin":"B012345678","tag":"buckle","quote":"original sentence"}]`，不可附加 prose/字段。quote 必须逐字匹配本批输入，tag 为最多 50 位小写英文/下划线。每批最多 30 秒、输出最多 1MB，stderr 不记录。失败/非法输出记录错误并忽略整个补漏结果，不影响词典标签和流水线。未配置命令时 no-op。

## 1688 人工兜底

1688 搜索仅为短名单线索，价格为原始文本，可能是阶梯/区间，MOQ 缺失留空。登录或风控失败写日志并输出 `[]`；不会假造 3 家。使用自己核验的真实供应商 JSON：

```json
[
  {"title":"真实商品标题","price":"原页面价格文本","moq":"起订量文本或空串","shopName":"真实店铺名","url":"https://detail.1688.com/offer/真实数字ID.html"}
]
```

实际链接必须是 HTTPS `detail.1688.com/offer/<数字>.html`，脚本校验并去重。MOQ/店铺/价格允许缺失；请补足至少 3 条有效候选后再评审。fixtures 中的三条供应商是**虚构测试数据，不能用于采购或写库**。

## 最小 products:create

不添加 UI/RBAC/API，不直接 create ProductRecord。沿用 `scripts/backfill-product-image-assets.ts` 的受控维护身份规则：

- `DATABASE_URL`：操作者明确选择的目标 PostgreSQL；CLI 不自动读取或连接生产服务器。
- `SELECTION_ORGANIZATION_ID`、`SELECTION_ACTOR_USER_ID`：必填；在事务内检查目标组织成员，用户 active 且角色 owner/database_admin。
- `--workspace-id default`：目标作用域。管理员具备该组织维护权限；不提供普通用户绕权入口。

保留目标工作区既有账户/站点设置，新默认工作区使用仓库默认空账户/站点。事务中分配 SKU（复用 nextSku），使用 PostgreSQL advisory lock 序列化本 CLI，且 existingRecord=null 强制创建；并发其他入口仍由唯一键阻止覆盖。`saveProductAggregate` 负责 revision、审计、DataChangeVersion、附件绑定、Outbox。事务后用现有 processProductOutboxEvent 处理投影/通知，不要求新增 Redis 服务；失败会保留 durable Outbox，created.json 标 `queuePending`，由既有 worker/受控重试修复。检查可见性时要确认投影成功与目标组织/工作区。

草稿 UUID 在 workbook 重建时保留；数据库按 UUID 查重，同一草稿重跑 `--write` 不创建第二个 SKU，也不更新原商品；新选品请使用新 slug。创建收据写 created.json；不把产品改回 DRAFT。原始 draft 保留用于追溯。空竞品和 fixture 草稿拒绝创建。

回滚：本次不修改主 schema、现有 API 或 UI，移除脚本及 package scripts 即可停用。正式商品误创建后使用 ERP 已有审核/取消流程处理，禁止本脚本自动删事实记录、审计或附件。图片上传是独立动作；数据库创建失败不会自动删除已上传资产。

## 验证与当前缺口

```bash
npm run test:selection
npm run test:selection:create  # 本机 Docker 临时 PostgreSQL，包含 create/并发/Outbox/权限集成验收
npm run typecheck
npx eslint scripts/selection-pipeline
npm run selection:run -- --keyword "kayak cockpit cover" --slug selection-offline-validation --fixtures
```

数据库集成命令只创建随机命名、临时、loopback 映射且 tmpfs 存储的 PostgreSQL 测试容器，不读取调用环境原有 DATABASE_URL；测试结束自动删除容器。需要本机 Docker 和 postgres:16-alpine 镜像。

fixture 模式无外网请求、禁止 --write/--upload-images，使用独立 sqlite。假 ASIN、灰色示意图、虚构供应商均只用于解析/链路回归；raw/collection-info 和 draft.fixture 持续标记来源，不能绕过标记写库。解析测试使用真实 Chromium DOM；至少包含 search / PDP / reviews，还覆盖 1688 解析、词典、补漏输出校验、SQLite 配额、站点熔断、workbook 表头和未授权创建拒绝。临时 PostgreSQL 集成测试另覆盖聚合 create/replay、并发 SKU、角色拒绝、附件组织隔离回滚、审计/Outbox/summary projection。

2026-10-25 本机试跑 `kayak cockpit cover`：一次搜索为空，另一次受控验证获得 1 个真实竞品 `B0GH7CKL75`、BSR/评分/评论数/要点与真实下载 JPEG；价格缺失。评论页进入登录/风控，当前站点熔断；1688 进入登录/风控，尚无真实供应商。因此真实 workbook/draft 已产出，但真实差评标签与 ≥3 家供应商仍未验收；人工 JSON 兜底和离线标签链路可独立验证。

未提供目标数据库的组织/操作者身份和 ERP session，**未执行真实上传/写库，也没有声称创建了可见 SKU/fileId**。下一步由具备权限的操作者审查 draft，提供同作用域的上传会话和上述数据库环境变量，运行 create --write 并检查 created.json/ERP 列表。生产使用前还需在隔离数据库验收创建、并发 SKU 唯一性、跨组织附件拒绝和 Outbox 恢复。

Amazon/1688 页面结构、地区、登录及风控会变化；HTML fixtures 不是活网站点稳定性的保证。只采集自己有权访问的数据，遵守目标站点 ToS、robots 与访问限制，不绕过登录/验证码，不提高并发碰撞站点。竞品图片仅用于内部研究；对外使用需另行确认版权。本功能不部署服务器、不迁移数据库、不安排后台定时采集。
