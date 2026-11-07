# 加拿大目录展示价格空值兼容与原任务恢复（待批准执行）

## 已核实差异与候选变更

本机CA最后一批SCP原任务 `4521f0f2-96cd-48e2-afe1-e1768e825da0` 于2026-11-07 11:26 UTC在DOWNLOAD解析失败，未发布错误事实。加密原文共14行，新增观察到 `impressionData.impressionMedianPrice = null`；其余空值路径已经覆盖。原请求、ASIN、站点、日期及选项继续由现有严格解析验证。

候选补丁仅在 `src/lib/amazon-sync/observation-parsers.ts` 的 SearchCatalogPerformanceImpressionData 中允许该单一完整金额对象为null，保留为未知。非空对象仍须满足amount/currency格式，count/date/ASIN/必填键严格不变；不容许amount单独为null，不删除字段。其他报告、SQP单位、权限、API、数据库模型和商品主数据不变。无额外查询、遍历或队列，不增加采集请求频率或明显性能开销。

已编写单测与隔离集成，真实加密原文只读回放14行成功；未向运行Worker加载此补丁，未重试CA。验证结果补记执行前记录。

## 拟执行具体范围

- 使用根.env唯一运行配置，核验本机数据库127.0.0.1:55439/amazon_sync_live_local、Redis127.0.0.1:6399/0及一致性。仅通过原manager54626优雅重载注册amazon-sync子进程（当前观察PID48331）；其他Worker不重启，不新建消费者。执行前复核PID身份。
- 仅恢复CA上述原任务的DOWNLOAD检查点；组织amazon-live-local、workspace default，授权3895911f-89c4-4ebd-8212-dc58bede447e revision3，来源1299517d-fefa-433e-9342-bfc12bfe0b62、站点A2EUQ1WTGCTBG2、固定2026-10-25至31/WEEK、SCP原ASIN批次。经现有request/approve/apply链提交control-task retry。
- 保留原30次请求/10000行/.01rps及租约、冻结revision、RBAC；不重置请求、不重建报告/任务。链接过期沿既有403/404路径刷新同reportId并计入剩余预算。成功后仅由已启用有限计划推进其余既定清单。
- 验收同reportId、createReport仍1次、历史计数未重置，发布14行与原文严格解析结果一致，null保持未知；四站报表/批次/ASIN核验。出现新差异时保留检查点并停止新增恢复，不自动扩大修复范围。

无迁移、配置/凭据修改、生产/CI发布、commit/push。回滚仅撤销这一nullable映射并由同manager重载；不删事实、审批/原文/检查点，不数据库回滚，不改变已发布值。此次新字段与CA任务不包含此前精确的BR/MX SQP恢复审批，获得本方案明确批准前不执行真实重载或CA重试。


## 执行前验证结果（2026-11-07 11:30 UTC）

29项相关单测、12项品牌隔离集成通过；新增集成验证null展示价格对象发布为未知。单测验证null对象可通过，但计数null、金额amount null、缺失必填价格键仍拒绝。真实加密原文只读回放14行通过，没有数据库写入或Amazon调用。check:fast 1178项测试通过、lint 0错误/7项既有警告、类型通过；受控CA恢复入口追加后再次类型、定向lint通过，git diff --check通过。后端单字段解析改动不重复跑未变UI浏览器或生产构建。上轮SQP/页面已通过的10项浏览器证据仍适用于未变页面。

受控恢复命令已准备为 `node --import ./scripts/runtime/database-bootstrap.mjs node_modules/tsx/dist/cli.mjs scripts/collect-amazon-brand-analytics.ts --retry-ca-catalog-downloaded`，仅接受上述CA原任务FAILED/DOWNLOAD与精确日期/周期/预算/授权版本，四站来源存在性已校验；尚未执行。用户后续若批准，本条不授权恢复其他失败任务或改变限流。


## 继续实施与真实恢复（2026-11-07 19:44 北京时间）

用户本轮授权继续实施和生产级验证，无需逐小步审批。11:36:05 UTC校验根runtime目标后，仅向原manager54626的唯一amazon-sync子进程48331发送SIGTERM；原manager拉起60742，其他Worker保持原PID。通过原request/approve/apply链恢复CA原任务4521f0f2-96cd-48e2-afe1-e1768e825da0，保留原报告、预算和历史计数。11:43 UTC仍WAITING，apiRequests10；未将恢复提交写为发布完成。

新增只读 --verify-recovered，精确绑定BR/MX/CA三个已审核原任务，核对授权、站点、固定周、预算、加密原文摘要、原createReport仅一次、reportId和逐行业务键/facts一致；私有事实只比较摘要，不在断言输出业务数据。待发布任务返回退出码2。执行BR2行、MX9行全部通过，apiRequests14/11且原报告保持；CA待发布。

修正Lili四处目录测试的旧数量断言，使用明确工具白名单核对，不放宽业务权限。check:fast的1178项测试全部通过，lint0错误/7项既有警告；品牌隔离集成12项、权限隔离集成12项、品牌浏览器10项通过，生产构建通过。新增只读CLI后补跑类型和定向lint；不以这些本地验证代替生产验收。

11:43 UTC四站已发布查询/批次数/ASIN核验全部通过，总52/90（US15/29、CA10/21、MX14/23、BR13/17）。搜索词尚未发布；原计划按已批准清单及.01rps继续。

服务器123.207.47.225只读检查：五个systemd服务active，web登录200，未登录operations307/API401；web/sync NRestarts=0。线上RELEASE.json仍324e99d7ab31b6e54ffbb0a4b87e4e6fc72d2b56，品牌集合迁移产物未包含在线release。以上只证明瞬时运行和未登录拦截，不证明本轮代码已发布或生产业务闭环。当前工作区包含持续变化的Lili/选品/设置等混合改动（观察73项），未冻结统一提交范围，故未commit/push或执行生产迁移/发布；不绕过干净checkout及BASE_SHA发布校验。
