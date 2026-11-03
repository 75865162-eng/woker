# 分阶段开发、风险与验收

## 分期及依赖

Phase0评审通过后才能开始Phase1。每阶段先冻结当前官方API依据及最小范围；涉及全局模型/权限/存储/worker或明显性能成本时，先提供范围、回滚、验证方案，取得对应确认后改。服务器发布不包含在开发批准内。

| 阶段/工作包 | 具体任务与交付 | 依赖/退出门槛 |
| --- | --- | --- |
| P0-A 审计 | 当前能力、文件图、真实读写/队列、官方model及待核报告 | 本评审包完成；不能以模型存在替代真实授权 |
| P0-B 设计 | 七页原型、状态和指标定义、架构/模型/风险/测试清单 | 用户评审决策；无业务迁移 |
| P1-A 身份隔离 | 多authorization、seller/region凭证路由、复合约束、旧数据归属盘点 | 密文兼容/跨组织/多seller/多region测试；迁移人工审核 |
| P1-B 计划任务 | 扩Schedule/Run、目标展开/planVersion、dispatch恢复、幂等、lease、日志attempt、范围筛选API | 防双跑、真实DB/Redis故障恢复；旧调度停用/drain切换 |
| P1-C 两域接入 | 复用FBA库存/在线商品，分页stage/checkpoint、完整性校验、scope head/manifest | 不串站点、成功空快照、token失效、失败不发布、容量测试 |
| P1-D UI基础 | 数据总览、计划、任务/详情、新鲜度；域目录和授权安全摘要；现有业务入口可达 | loading/error/403/工作区切换迟到响应、真实状态一致；未实现域保持规划中 |
| P1-E 闭环 | 更新旧contracts/docs、专项性能/安全、部署清单和回滚演练 | 评审验收通过；未提供真实环境则仅可标“待联调”，不能整体宣称生产完成 |
| P2-A 订单 | 冻结2026/v0版本选择；最小非PII订单/行、更新时间重叠/去重/迟到/取消更新 | 不混版本参数；子数据失败不推进cursor；无买家数据泄漏 |
| P2-B 报告框架 | create/discover/poll/document/download/parse/validate/complete持久状态；销售流量逐日回查 | 网络未知创建结果、DONE未下载、下载过期、坏压缩/缺日验收 |
| P2-C 货件/服务 | 未完成货件/行/状态、销量标准口径、Amazon补货来源服务；FBM数量独立核验后小包接入 | 订单销量/流量报表指标不可重复相加；未知ETA不扣库存；赛狐分支回归 |
| P3-A 财务结算 | 交易增量/30天补偿、结算报告发现/下载/解析、币种与结算批次口径 | posted时间不冒充updated；交易/结算重叠不求和；迟到状态/撤销处理 |
| P3-B 售后库龄 | 退货、赔偿、库龄报告，主键/状态/数量/币种、对账及差异issue | 实时官方report资格/字段核验；退款/退货/赔偿不重复计账 |
| P4-A 高级调度 | 通知驱动、usage plan动态预算、回填管理/公平性 | 通知重投/乱序/重复/伪造校验，持续校准兜底 |
| P4-B 质量/MCP | 完整质量中心、落库只读MCP工具、显式触发独立权限 | 日志及查询无PII/密钥、租户隔离、覆盖/来源/空值契约 |
| P4-C 监控扩展 | 重点ASIN价格/Featured Offer、品牌分析、告警去重 | ASIN规模预算/周期资格、源延迟和告警恢复闭环 |

Phase1先建最小通用执行边界，Phase2才加入完整报告状态机；Phase1新增cursor/checkpoint服务于已接两域，不能到Phase4才补基本恢复/隔离。Phase4是回填管理UI及高级策略，基础回填/优先级/安全恢复在首次相关域上线时就需具备。

## 风险登记

| 级别 | 风险/证据 | 处理/回滚 | 验证 |
| --- | --- | --- | --- |
| 阻断 | Secret provider全局唯一＋单Seller假设 | Expand授权路由、复合键；多凭证后禁止退旧单凭证执行器 | 两组织/两seller/同seller多站点、region路由和密文AAD |
| 阻断 | 当前run/lock/head按工作区域 | task/lease/cursor/head一起拆，旧scope任务drain后切 | 同SKU跨店铺跨站点无覆盖，失败scope不变新鲜 |
| 高 | 所有页内存累计/事务60秒/5万行上限 | 有界stage/chunk，先benchmark；保留旧发布读路径 | 1k/5k/10k SKU＋超过5万行/1000页的可解释失败/分片 |
| 高 | 中断不续跑、RUNNING重投跳过 | lease/fence/attempt+checkpoint，队列DB对账 | kill -9前后、Redis清空/不可用、旧worker复活 |
| 高 | 当前固定600ms和统一3次重试 | 已核usage plan＋per-operation预算＋jitter | 429/5xx/网络/timeout和无quota头，验证有界请求数 |
| 高 | Reports DONE与落库成功混淆 | 远端/本地双状态机；publish最后一步 | 各阶段断点/校验失败/下载URL过期/未知create结果 |
| 高 | 财务/订单迟到或状态回退造成重漏 | 重叠/补偿、业务键、来源版本、窗口重跑 | 同行重复/晚到/旧版本晚写/取消或退款 |
| 高 | 授权及外部文档不完全可用 | 当前角色/站点/API版本冻结，不支持域禁用 | 受控试点能力探测，403与token撤回 |
| 高 | 赛狐与Amazon指标混加/人工主档被覆盖 | source/口径强制、显式来源、ProductRecord只读校准 | 双源同SKU不加总，人工保存不带外部字段 |
| 高 | raw报告包含PII/签名URL/解压资源攻击 | 最小字段、默认禁PII原件、storage ACL/URL白名单/流式上限 | 受限响应fixture、日志扫描、URL过期/内网/压缩炸弹fixture |
| 中 | 调度旧100条扫描及长补货饿死其他工作 | 分页due claim/步骤异常隔离/回填时间片 | 连续多个计划周期、实时等待与公平性测量 |
| 中 | UTC/站点日/上海补货日混用 | 日期窗口带IANA时区/口径，原分支兼容 | DST/跨日/跨月/重复小时与7天/30天窗口 |
| 中 | 历史快照/日志/raw持续增长 | 分批retention，不删current/在用版本；先核保留策略 | 存储增长、清理中断/引用保护和审计 |
| 中 | UI筛选只筛20行、连接校验算同步成功 | 新服务端聚合/分页，区分readiness | 跨页数量/趋势/筛选一致、0条成功manifest |
| 中 | 旧文档与代码不一致 | 最终行为回写既有contracts/docs | 代码—契约—UI逐项走查 |

## 验收矩阵（每阶段适用范围必须通过）

未实现数据域不以模拟通过充当已接入；对阶段不适用项写清原因，首次实现该能力时成为阻断门槛。fixture测试、DB/Redis集成、受控Amazon联调与性能证据分别记录。

| 验收项 | 场景及可判定结果 | 阶段门槛 |
| --- | --- | --- |
| 1 多店铺/站点/租户 | 两组织/工作区、两seller、同seller两站点、同SKU；伪造scope/任务ID/授权ID均拒绝，不返回他方日志 | P1起所有阶段 |
| 2 大数据量 | 1k/5k/10k SKU，记录API/SQL/内存/网络/队列/浏览器P50/P95/P99；安全上限边界不误报成功 | P1起；各新增域按真实规模 |
| 3 中断恢复 | 在请求后/页写后/checkpoint后/publish前杀进程，重启不漏不重、不进错水位；旧lease不能提交 | P1起 |
| 4 重复任务 | 多调度器＋手动＋Redis重投并发；同scope只有一个publisher，幂等重放同payload返回同任务 | P1起 |
| 5 限流重试 | 429/5xx/网络、quota头缺失/变动、403、token失效；重试有界、无风暴、日志计数真实 | P1起 |
| 6 分页完整 | 多页/空最后页/循环token/过期token/单页异常，只有完整有效快照可发布 | P1起；报告下载完整性P2起 |
| 7 去重迟到 | 重复行、跨窗更新、旧写晚到、删除/取消/退款；字段未知保持NULL | P1快照去重，P2/P3迟到/补偿 |
| 8 回填实时并行 | 长历史任务分片后实时任务可运行；无相互水位覆盖，预算/队列最大等待有证据 | P1任务机制验证；P2起真实历史域 |
| 9 UI真实状态 | 202显示排队；报告READY未显示成功；DB与队列不一致显异常；只读/403/加载/空/失败/切scope | P1起；报告场景P2起 |
| 10 数据源/口径 | 订单件数vs订单数、日期/币种/履约渠道、赛狐/Amazon/PPC来源独立；商品主档不变 | P1起各阶段 |
| 11 权限敏感信息 | API/MCP/CLI/日志/导出均无密钥/PII；授权撤回及跨tenant查询失败 | P1起 |
| 12 构建部署 | 按最小验证路线；合码/发布CI完整check、artifact SHA/plan/base检查、健康/回滚 | 各阶段合码；生产部署仅明确授权 |

P95门槛/并发/容量预算在试点前确认，缺基线不得写“性能已达标”。建议初始读路径退化预算不超过10%，实时任务不得被整个历史批次阻塞；绝对时延和最大等待依试点规模冻结。

## 验证路线与阶段交付模板

- UI/局部状态：相关回归＋TypeScript；API/筛选/共享服务：check:fast；DB/队列/权限：额外真实DB/Redis集成和故障注入，不能仅mock。
- 准备合码/上线：CI完整check＋diff检查、迁移审核、容量/恢复报告；遵循既有CI artifact流程，不在本机或服务器重复production build。
- 每阶段必交：实际修改文件清单；迁移SQL及回填/约束/锁风险；旧新API契约及兼容；UI路径/状态；测试命令、环境、数量/结果及未测；未完成和阻断；部署计划/需要重启的服务、数据保护及回滚。

## 部署与回滚（后续实施使用）

本阶段无部署。后续先完整git status盘点混合工作区，用户确认同步范围后提交/推送。迁移/部署脚本须人工审核；以线上RELEASE commit作base_sha，GitHub Actions构建/测试/打包，服务器校验artifact与deployment-plan再发布，按实际受影响worker重启。保留.env、uploads、volumes及既有密钥；不触发seed或商品维护脚本。普通文档仅同步GitHub。

回滚：停该范围新计划、合作取消/等待安全checkpoint、关闭dispatch、退兼容应用版本/current symlink，保留新表及旧数据/manifest；恢复旧调度前确认无新publisher在运行。多凭证后旧单凭证程序不得执行同步。数据库不down、不删表、不还原生产快照；迁移只前进，release摘要记录database:not_rolled_back。新旧服务器数据相互独立，不自动迁移或改DNS。

## 本次 Phase 0 交付记录

- 新增文件：本目录README、audit、api-domain-matrix、architecture、ui-design、delivery-plan、official-model-evidence.json、official-live-doc-evidence.json、prototype.html、prototype-overview.png。没有修改业务代码、Prisma、应用API或运行配置。
- 已执行既有针对性测试：`node node_modules/tsx/dist/cli.mjs --test tests/amazon-sp-api-client.test.ts tests/amazon-inventory.test.ts tests/amazon-seller-bindings.test.ts tests/operations-readiness.test.ts tests/operations-schedules.test.ts tests/operations-read-models.test.ts tests/operations-replenishment.test.ts tests/operations-replenishment-service.test.ts`：**46/46通过**。这是审计基线，含mock权限/加密/解析/计划/读模型/补货，不证明真实DB/Redis和Amazon联调通过。
- 官方依据：10份当前Amazon API model成功读取；另核对Sales/Traffic及Search Terms schema和历史官方report说明。HTTP初访403后经官方页面工具取得实时Analytics/FBA/Settlement及角色文档，已修正库龄/结算候选；实际卖家资格与未覆盖的操作细则保留为实施前核验。
- 原型已在浏览器走查七页导航、店铺/站点筛选、自定义周期非法值拦截及保存、计划暂停/恢复、未开发域禁用、失败任务详情/重试、质量证据展开；320px和768px检查document宽度无页面横向溢出，表格使用容器横向滚动。保存prototype-overview.png作为桌面评审画面。仅为原型交互验证，不证明真实API状态一致性。
- 没有业务TS变动，不默认运行tsc、完整check或应用E2E；后续进入Phase1按上述门槛运行。没有真实同步、生产/服务器检查或migration执行。
- 文档静态验证：本目录Markdown相对文件链接均存在、两份JSON可解析、原型脚本语法通过且无网络请求；新增文本无行尾空白，`git diff --check`通过（另行覆盖未跟踪评审包）。
- GitHub：未提交/推送。原因是初始工作区已有12项混合改动，按AGENTS“全改动区同步”必须先确认整体范围；本阶段评审包留本地，不静默遗漏既有改动。
- 风险：仍待用户评审架构和原型；真实授权、报告当前细则、多seller迁移、恢复/性能等均未完成。停止于Phase0，不能把未来设计标记为已交付后台能力。
