# SQP 原值兼容修复与本机原任务恢复方案（巴西已批准并验收完成）

## 已核实问题和具体修复

巴西 SQP 原任务 `4f85f662-0f02-41ee-a780-35bf20429c46` 在 DOWNLOAD 解析阶段失败，已加密保存下载原文，未发布错误数据。该报告含2行。只读检查确认来源、ASIN范围、固定周及请求选项匹配；目前策略请求4次，原30次预算尚余26次。

已准备的本地代码变更：

- `src/lib/amazon-sync/observation-parsers.ts` 仅允许 SQP 已观察到的6个指标为null：cartAddData 的 asinCartAddShare/totalMedianCartAddPrice/asinMedianCartAddPrice；purchaseData 的 asinPurchaseShare/totalMedianPurchasePrice/asinMedianPurchasePrice。身份、日期、必填字段存在性、计数、其他空值及非空金额校验保持严格，null保留为未知，不填零。
- 真实SQP份额/比率含5.26、25.0、100.0等上游百分数原值。SQP这类字段允许范围0–100，原始十进制文本不换算，facts.shareUnit 标为 `AMAZON_NATIVE_SQP`。官方示例中的0–1文本仍原样保留，不能仅凭值大小猜测单位。其他报告保持原0–1边界与 `FRACTION_0_1`。当前没有已发布非空SQP事实需要迁移；此前首份SQP为成功空报告。
- 品牌报告及ASIN页面明确SQP保留上游原值、可能采用百分数且不与其他报告混算，修正原先所有报告均为0–1的提示。API没有新增路径或权限入口；影响仅限SQP解析与现有facts单位元数据，不改变指标计数或商品主数据。
- `scripts/collect-amazon-brand-analytics.ts --retry-sqp-downloaded` 是已写好但未执行的受控入口，仅接受下述原任务FAILED/DOWNLOAD检查点和既定预算；前置检查四站来源、授权revision、库身份、固定周及SQP类型。经原request/approve/apply审核链提交control-task retry，不创建替代任务/报告、不重置计数。

本地回归与只读验证见下方执行前验证记录。候选解析边界只增加2个SQP属性覆盖映射及对应上限判断，无数据库查询、队列或schema新增，无明显资源消耗变化。

## 待执行范围

1. 只核验并优雅重载原 manager（当前PID54626）管理的注册 `amazon-sync` 子进程（观察时PID39728），由同一个manager自动重启。执行前再次核验父子关系、根配置一致性及唯一实例；不启动第二消费者，不重启其他Worker。
2. 仅恢复巴西上述原任务的DOWNLOAD检查点。目标仍为根 `.env` 的本机 PostgreSQL `127.0.0.1:55439/amazon_sync_live_local`、Redis `127.0.0.1:6399/0`、组织amazon-live-local/default、授权3895911f-89c4-4ebd-8212-dc58bede447e revision3、BR来源23c456ec-66fa-429f-b79e-588f05c4a33f，固定2026-10-25至31/WEEK。保持原ASIN批次、每任务30请求/10000行、共享 .01 rps、所有权限/审批/frozen revision/lease fence。
3. 原下载链接若过期，只使用已有403/404刷新同reportId文档路径，计入剩余预算；不自动提高预算、不重建报告、不重置任何历史计数。成功后仅由已经启用的原有限清单继续推进其余已批准项目。
4. 验收原任务成功状态、2行保留null与上游数值、原报告ID与计数未重置，四站页面查询/已发布批次与ASIN视图一致。若出现新的未核实字段差异，停止该任务的新增恢复，保留证据后重新评估。

无迁移、无环境/凭据修改、无生产/CI发布，无Git提交/推送。并行Lili/选品改动仍未冻结，不合并发布其工作区。

## 回滚和边界

回滚仅撤销本轮SQP兼容判定/单位提示并通过原manager重载同一Worker，恢复严格拒绝行为；无需数据库回滚。保留原任务、下载原文、审批日志与所有已发布结果，不删除或改写事实。若新数据已经发布，保留其真实原值与单位标记，不能通过回滚代码把这些值重新标记为0–1。未获得本方案明确批准前，不执行上述Worker重载、真实任务重试或外部调用。

## 执行前验证

- 实际加密原文只读回放：修复后可解析2行；仅输出字段路径、类型、行数与校验结果，不输出ASIN、查询词或签名URL；没有数据库写入或Amazon调用。
- 29项相关单测通过，覆盖6项null保留、身份/日期/计数/必填键/非空金额拒绝、百分数与官方示例小数文本原样保留、SQP超过100拒绝、其他报告原校验。
- 11项品牌隔离集成通过，包含模拟失败后从相同报告DOWNLOAD重试、checkpoint/计数不重置、createReport仅1次、null与原值发布；临时PostgreSQL/Redis与mock网络，不加载根.env。
- 10项品牌隔离浏览器测试通过，包含SQP原始单位提示；页面不执行真实API或任务。
- check:fast：1178项测试通过、lint无错误、类型通过；该次lint有7项原有警告和1项新增测试类型变量警告，新增警告已修正。最终lint/类型结果补记在本地验收文档；git diff --check通过。未运行生产构建或生产验收。


## 已批准执行记录

用户明确批准“SQP修复重载与原任务恢复”，范围仍为本方案的BR原任务。2026-11-07 10:46:06 UTC（北京时间18:46:06）根运行配置只读校验通过后，核实PID39728/PPID54626仅为注册amazon-sync子进程，发送SIGTERM；同一manager自动拉起PID48331，其余注册Worker保持54629/54631/54633，未启动额外消费者。随后执行已审核的 --retry-sqp-downloaded，原request/approve/apply链成功将BR原失败任务恢复；没有重置请求计数、创建替代报告或变更配置。

11:21:50 UTC新进程心跳online，队列可读、failed=0；这是瞬时运行观察。恢复时旧链接过期：10:47和11:18 UTC下载返回403，已有路径刷新同reportId；11:22:28 UTC getReportDocument返回200，原任务回到DOWNLOAD。11:23:55 UTC尚待下载配额，策略请求9次/30次、剩余21次，原createReport调用仍1次。保留原报告、加密检查点及所有历史计数。未将恢复执行中写成真实发布完成。

另外只读盘点发现MX原SQP任务699d009f-9676-454b-a84e-1a9af05d75ff此前失败；使用本轮同一修复可只读解析其9行，6项null路径相同。但本方案审批精确限定BR任务，尚未恢复MX，不自动扩大任务范围。其他站点沿原批准有限清单继续。


## 巴西恢复验收完成（2026-11-07 11:25 UTC / 北京时间19:25）

原任务于11:24:51 UTC成功发布2行。只读逐行以businessKey匹配最新原文的严格解析结果与AmazonDomainObservation.facts，全部一致，包含6项null和原始十进制数值；报告ID与最早保存的原报告ID一致，createReport请求始终仅1次，apiRequests14未重置。恢复过程链接过期计入原预算，未重建报告。真实发布验收四站全部通过，BR的SQP已发布2批（1批空、1批2行），查询2行与任务一致；四站ASIN视图均通过。总46/90：US13/29、CA10/21、MX12/23、BR11/17。搜索词尚未发布，仍不声明全量或生产级收口。

## 墨西哥同类原任务恢复补充方案（已批准，恢复执行中）

发现原MX任务699d009f-9676-454b-a84e-1a9af05d75ff失败在DOWNLOAD；其加密原文只读回放使用已应用同一SQP修复可完整解析9行，6项null路径相同，无新增解析规则、页面变更或未知差异。原任务策略请求4/30，保留原报告；不是本次巴西恢复新建的任务。

仅拟使用已准备的 `scripts/collect-amazon-brand-analytics.ts --retry-mx-sqp-downloaded` 经现有request/approve/apply链对这个精确任务执行retry。目标为同根.env的本地数据库/Redis、amazon-live-local/default、授权revision3，MX来源cc6bbaa8-f8d7-4a96-95bb-6ce9fb7ec9ea/站点A1AM78C64UM0Y8、固定2026-10-25至31/WEEK、原ASIN批次。复核四站来源、FAILED/DOWNLOAD阶段、SQP及30请求/10000行/.01rps，不符合即停止。原链接过期只刷新同reportId并计预算；不新建报告/任务、不重置请求，不扩大到其他失败任务。成功后由已启用有限清单继续其余批准项目。

Worker48331已加载并真实验证同一修复，本补充不需要再次重载，无配置/凭据变更、迁移、生产或CI发布、commit/push。对原失败检查点恢复后，失败不会发布；保留原审批、checkpoint、raw及旧事实，不通过删除记录回滚。验收同报告、无重复create、计数保持、预期9行和实际原文一致，再执行四站只读发布/ASIN核验。若出现新差异，不自动扩大修复范围。本补充范围尚未获明确批准，恢复命令未运行。


### 墨西哥已批准执行记录

用户批准后于2026-11-07 11:27:16 UTC执行 --retry-mx-sqp-downloaded，经原审批链恢复精确MX任务699d009f-9676-454b-a84e-1a9af05d75ff；未重载Worker。原链接11:28:23返回403后，通过既有同reportId刷新路径11:29:52 getReportDocument返回200。11:31 UTC任务仍待下载，策略请求6/30，createReport仍1次、原报告ID匹配，无历史计数重置。尚待真实发布验收。
