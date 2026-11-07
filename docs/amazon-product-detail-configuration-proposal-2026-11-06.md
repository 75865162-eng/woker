# 商品目录与 Listing 详情配置预审

## 范围与当前状态

用户要求开始配置。2026-11-06 22:12 北京时间仅对独立本机 PostgreSQL 127.0.0.1:55439/amazon_sync_live_local、amazon-live-local/default 做 RepeatableRead + READ ONLY 聚合查询。没有 Amazon HTTP、真实配置写入、任务创建、Worker 重启、迁移、提交推送或部署。服务器不在范围内。

有效授权 aoocy-us revision=3，Seller ID 已存在；approvedRoles=[]，没有 Product Listing 角色证据。另两份停用授权排除。两个详情域数据源数量为 0。

| 站点 | 当前在线商品 SKU | 去重合法 ASIN | SKU 分片数（100/片） | ASIN 分片数（100/片） |
| --- | ---: | ---: | ---: | ---: |
| 美国 | 224 | 222 | 3 | 3 |
| 加拿大 | 166 | 159 | 2 | 2 |
| 墨西哥 | 165 | 164 | 2 | 2 |
| 巴西 | 114 | 114 | 2 | 2 |
| 合计 | 669 | 659 | 9 | 9 |

数量按站点累计，不代表跨站去重。四份在线商品当前头均是完整成功快照，但冻结授权 revision=2，冻结 Seller ID 与当前身份不匹配（此前为空）；不得修改旧快照将其冒充当前身份已核验。新详情发现应等待当前 revision=3 的完整 catalog 快照，表内数量仅供容量预估，最终清单按新快照冻结。

## 待审阅的最小实现与配置清单

1. 只扩展 listing_details / catalog_items，保留静态显式 SKU/ASIN 策略和现有调用。增加从同组织、工作区、授权、卖家、店铺、站点的完整 catalog 发布头发现对象的策略。每轮冻结上游 runId、授权/来源 revision、总数和清单摘要；检查覆盖、身份、对象合法性和预算，失败时保持旧发布版本。
2. 每站每域保持一个来源，共最多新增 8 个来源；不能通过多建同域来源规避数据库唯一约束。每轮一个可恢复任务，内部按最多 100 个对象分片和有界游标推进；当前单 HTTP 租约、幂等暂存和加密检查点继续复用。全部分片完整成功才切换同一来源的 activeRunId，避免读取页只能看到最后一片。需扩展策略/状态机/processor/调度及审批冻结证据，不是只修改配置。
3. 预期配置：美国 ATVPDKIKX0DER、加拿大 A2EUQ1WTGCTBG2、墨西哥 A1AM78C64UM0Y8、巴西 A2Q3Y263D00KWC；各站 listing_details 和 catalog_items；沿用对应 catalog 的 authorizationId/sellerAccountId/applicationId。新来源先保持禁用，24 小时目标周期，单源请求速率不超过 0.2/s、初始请求预算最多 500/轮、对象上限 1000/站/域，超出明确阻断并重新审阅。这里是拟议参数，尚未写入配置。
4. 启用前须核实 Product Listing 实际资格并通过现有受审流程记录，不能自动补写角色。授权更新会影响在途任务 revision，必须先单独审阅身份/角色更新方式及在途任务衔接，不直接调用普通保存授权覆盖。无需用户提供已取得的 Seller ID。
5. 首次运行必须另行列出来源 ID、配置摘要、上游快照、具体对象数及授权版本供批准；保存配置不等于启动任务。若后台会对新来源自动建计划，不能将 enabled=true 的保存称为“只配置不启动”，应验证禁用来源和计划的调度门禁后才应用。

## 性能、验证与回滚

按本次数量，初次正常详情 GET 约 1328 次，另有获取新 catalog 快照、轮询和失败重试开销；每日按同规模刷新也会增加类似请求与观察记录。保留 Worker 并发 1、共享限流与现有任务优先级，不降低上游退避。新增任务会占用同一 Worker 并延长其他回填等待；替代方案是先单站/指定对象人工采集，或首轮成功后暂不启用每日计划。

开发验收使用隔离 mock，覆盖跨组织/站点/授权隔离、旧身份拒绝、分页对象发现、100/101/224 分片、重复/中断恢复、上游切换、撤权、预算耗尽、部分失败保留旧头及完整成功发布；相关测试与 lint/typecheck，按共享逻辑运行 check:fast。真实验收分别核对批准对象数、完整发布计数、错误及心跳，不以 mock 或下载成功代替。

回滚先经审批停用新增计划和来源，保留旧成功头、观察、审计及检查点；撤销新增发现模式代码时保留旧显式策略兼容。禁止自动删除历史事实、回滚数据库或停止其他域。预期无 schema/migration、.env、凭证或基础设施变更；发现需要新增这些内容时另行提交方案。

## 本轮交付

新增 scripts/preflight-amazon-product-details.ts，限定 --report-only 和上述本机数据库；不加载 dotenv、不解密凭证、不调用网络服务，仅输出身份是否存在、角色状态和聚合数量，不输出 SKU/ASIN 原文、Seller ID、报告下载信息或连接串。已真实执行只读预审。尚未实施共享逻辑修改或应用拟议配置。

## 已批准实施结果（2026-11-06 22:33 北京时间）

此节更新前述未实施状态。用户批准此方案，随后单独批准专用本机 Worker 重载及八个禁用来源应用。

- 四站各一组 getListingsItem / getCatalogItem，合计八次真实 GET 均 HTTP 200，八份响应均通过现有字段投影解析。原文仅保存于 git 忽略的加密证据 product-detail-probe.enc，不公开 SKU/ASIN、Seller ID、凭证或原始响应。单对象访问成功不能证明全店详情采集成功。
- 不修改 approvedRoles、授权 revision 或凭证。新增服务端认证加密的短期能力证据，绑定 organization/workspace/authorization/revision/marketplace/resource、成功 requestId 和解析结果，有效期 24 小时。它证明具体操作访问能力，不声称拉到了 Amazon 角色清单；失效、撤权或授权版本变化时阻断。每日长期刷新需要单独设计受控证据续验，当前未启用长期自动刷新。
- 保留静态最多100对象策略；新增 catalog_snapshot 发现模式，站内唯一源、最多1000对象、请求预算最多500、速率最多0.2/s。创建任务时按100行分页发现同身份当前完整快照对象，冻结清单/摘要和上游版本；一个可恢复任务逐对象请求并记录100对象分片索引，完整发布只切换一个 activeRunId。上游头或 revision 变化时阻断、保留旧发布头。缺少当前身份完整快照时拒绝创建任务。
- 新来源通过 requestChange / decideChange / applyChange 逐一应用，保持 enabled=false；真实核对八源均 revision=1、activeRunId=null、0计划、0任务。单次失败应用保留 FAILED 审批记录；未直接改数据库绕过审批。
- 发现并修复原应用标识检查错误：returns 的无策略兼容分支应检查 returnsPolicy，不应检查 domainPolicy；仍保留应用 ID 一致性校验。并行工作另有 seller-archive-only 策略改动，保留其原边界，不将其计为本轮实现。

| 站点 | Listing详情来源ID | 商品目录来源ID |
| --- | --- | --- |
| 美国 | 8b82d84b-17f5-4245-8d8f-6b3e12a9d359 | 9cff8618-c1af-4116-9de7-f8faecb98f6f |
| 加拿大 | f82178dc-c4f9-4b83-8483-c6ecd5f329c8 | c7e8cfd4-f2e6-42c9-b628-3fe4dd7d3969 |
| 墨西哥 | f59edded-69dd-45ea-bd66-8a9694b1fe85 | 73b04d76-da09-4a01-ab61-39dbea3fe723 |
| 巴西 | b9ef5ff2-87e7-4fe3-8550-921c92996031 | 137bc632-3d3e-4084-8d31-ef9d2fd15a6c |

Worker 重载前两次确认本机范围 RUNNING=0，核对 pid 文件和唯一父/子进程，向实际 Worker 子进程发送 SIGTERM 并等待退出，再使用原 isolatedEnvironment 启动同一入口。新进程父87117/子87118，standard，并发1；22:32:48心跳online。未更改.env、队列或其他Worker；工作区存在并发任务，本轮不归因其他进程修改。

### 验证及限制

- 新能力证据与发现单测2项、原观察单测15项通过；独立PG/Redis观察集成17/17通过，其中两个224对象案例检查跨100边界恢复、未完成不可见、末页24行、单一完整版本以及上游变更阻断。runner前置相关单测145/145通过。这些是隔离fixture验证，与八次真实请求证据分别记录。
- check:fast核心测试1052/1052通过；默认lint将既有.next-amazon-live生成目录纳入扫描而失败，因此不能声称check:fast整体通过。排除该生成目录的全源码lint通过（0错误、6条既有warning）。全项目TypeScript通过；最后应用标识修复后相关36项测试和TypeScript通过；定向git diff --check通过。未运行完整build/check、真实全店详情验收、服务器检查或生产部署。
- 22:33后再次核对，四站catalog发布头仍冻结revision=2，当前授权revision=3，Seller身份不匹配。下一步须按单独批准范围刷新四站catalog完整快照，再冻结首轮真实对象数及八源配置摘要，随后批准启用/启动。不得直接升级历史快照身份或先用旧对象清单声称全店成功。
- 八来源当前禁用且没有计划/任务；本轮没有执行全店1328次采集、没有更新ProductRecord、schema或迁移、没有commit/push或服务器部署。回滚先保持禁用，不删除来源、观察、审计或检查点。

## 用户批准首轮采集后的执行记录（2026-11-06 22:43 北京时间）

用户明确回复“批准采集”。本轮仅应用独立本机 localhost:3017 对应 amazon-live-local/default 的四站快照刷新与八个详情任务；未操作服务器、凭证、.env、迁移、commit 或 push。

四站 catalog 已通过现有申请/批准/应用服务完成新快照，均 SUCCEEDED、冻结当前授权 revision=3。美国230 SKU/228 ASIN、加拿大166/159、墨西哥165/164、巴西114/114；合计675 SKU、665站点内去重ASIN，首轮预计1340次详情GET（另有LWA及重试开销）。旧669/659仅为旧快照容量预估，未修改历史快照。

八源均经审批启用，已创建且仅创建以下八个manual任务；对象清单/摘要绑定当前完整catalog头，每轮完成才发布该来源的activeRunId。

| 站点 | 域 | 首轮任务 ID | 冻结对象数 |
| --- | --- | --- | ---: |
| 墨西哥 | catalog_items | 07202108-5e03-480b-a6d1-1dfa81cac17b | 164 |
| 墨西哥 | listing_details | 69319094-3233-4857-b6d8-5a1e0bbc21e6 | 165 |
| 加拿大 | catalog_items | baf5bd96-799f-4523-9875-e50661139fe1 | 159 |
| 加拿大 | listing_details | 53c572b4-4d38-4dbc-a656-568627fc80b3 | 166 |
| 巴西 | catalog_items | 37c095d8-3153-432d-8d77-72c7724f1bdf | 114 |
| 巴西 | listing_details | 040c5d89-27a3-48d1-a9cc-33c7105c2be8 | 114 |
| 美国 | catalog_items | 6f98d17d-8461-4521-90b3-00b033abbc7f | 228 |
| 美国 | listing_details | 48bc3260-ce7e-46a7-b2a1-9c0da1284b19 | 230 |

22:43:06只读核对：8任务均QUEUED（分片恢复队列状态），成功暂存13对象，getCatalogItem 7次200、getListingsItem 6次200；另有13次LWA 200。不将LWA计入详情完成数。8任务failedCount=0、throttles=0、error=null；八源activeRunId仍为空、rowCount=0，尚未完整发布，这不是全轮成功。22:42:48 Worker心跳online、并发1，进程仍为父87117/子87118。共享调度、每租约单HTTP、30秒恢复周期和0.2/s限制保持原值，当前没有承诺完成时刻。

同次核对详情域计划数=0、全部任务trigger=manual，没有重复自动任务。现有scheduler在来源启用且无在途任务后可创建daily自动计划：本轮未额外执行save-plan，也未完成长期能力证据续验，不能声称永久每日同步已验收。24小时能力证据和执行截止时间继续生效；到期或上游头变化时应保留暂存/历史并阻断，不得绕过校验或自动续期。

验证：编排脚本ESLint及全项目TypeScript通过；沿用前述发现/跨100对象完整发布的隔离集成结果，本轮未重复完整build/check。真实验收只达到新catalog完整成功及详情首批200/无错误；尚须在后台整轮完成后核对8个SUCCEEDED头、675/665完整发布计数、公开分页首末页与权限过滤。可使用原隔离环境加载器运行 scripts/collect-amazon-product-details.ts --status；不要为查进度重跑--start-details或--refresh-catalog。
22:43:53复核：已暂存18/1340对象（目录10、Listing8），八任务仍为可恢复WAITING，无失败、限流或错误。Redis队列当时active/waiting/delayed/failed均0；任务意图保存在PostgreSQL，等待既有30秒调度续派，并非任务全部完成。
