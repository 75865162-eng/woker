# 全工作区部署：具体审阅范围

状态：用户要求“全部部署”；已完成轻量盘点，尚未 commit/push、触发发布或操作生产。本文是提交前新增的部署审阅单，不代表批准或验收通过。

## 目标与代码范围

- 目标仅 `ubuntu@123.207.47.225`，应用目录 `/opt/amazon-ad-bulk-operation`，current `/opt/amazon-ad-bulk-current`。旧服务器不变。
- 分支 `codex/amazon-multistore-mcp`，当前 HEAD `614b085cc3f0374353220e1dc7d00850706fa6c2`。
- 本单新增前，Git 展开盘点为102个已跟踪改动文件、106个未跟踪文件；本单一并纳入。提交前须重新检查是否出现并发新改动。
- 全部现有未忽略改动纳入：运行环境/CLI、Worker 管理与恢复、Amazon 同步/报表/结算、Sellfox凭据及列表、Bulk导出、经营中台与设置页、测试、文档和部署模板。
- 本机 `.env`、已归档凭据、uploads、日志、构建缓存和 tmp 历史脚本均不进入Git或生产产物；此前删除的未跟踪文件不会变成Git删除记录。

## 需要确认的数据库范围

CI以真实线上SHA为base生成deployment-plan，只在计划要求迁移时执行正式待应用迁移。此次新增4项：

1. `20261106060000_amazon_audited_local_recovery`：扩大Amazon变更审批operation约束，保留旧值。
2. `20261106070000_amazon_settlement_attribution`：新增settlementPolicy、结算报告及明细表、约束和索引。
3. `20261106150000_sellfox_integration_credentials`：新增按organization/workspace隔离的加密凭据表；不导入本机凭据。
4. `20261106170000_runtime_execution_leases`：ImportJob/ImageUpscaleJob新增8个租约/重试字段及2个索引；旧running不自动接管。

正式迁移前必须核对线上已应用清单；若发现其他待迁移、漂移或不同checksum，停止重新审阅，不顺带执行。新增列、约束和索引可能持锁；不承诺无停顿。

## 部署、资源与回滚

- 复用现有GitHub Actions：影响分析、npm ci、测试、lint、生产构建、打包及release-check全部在CI。
- 仅依赖lockfile实际变化时允许服务器npm ci。本次lockfile增加saxes直接依赖，已有锁定版本不升级；依赖比较仍以线上base和CI计划为准。
- 更新5个systemd模板：统一生产模式；import服务使用worker:import避免启动重复消费者；依赖暂不可用时允许继续退避重试。
- 此次应用发布计划选择web及4类Worker切换到同一release，存在短暂网页/消费中断；重启Worker可能恢复已有排队任务或启用计划，不创建额外供应商验收任务。
- 生产.env、数据库目标、Redis目标、密钥、uploads和volumes保留，不同步本机数据库或归档。备份timer文件进入交付但不在本单启用；主机重启、Redis/PG故障注入也不在普通部署范围。
- 回滚只沿已有应用release路径；数据库迁移向前保留，不删除新表/列，不自动恢复数据库。若旧processor不能满足新执行权边界，停止并审阅，不能盲目回退消费者。

## 阻断与验收

- 本轮 git diff --check 通过；没有执行本地生产构建/打包或重跑测试。
- 默认SSH连接返回Permission denied(publickey)，线上RELEASE.json和磁盘尚未取得，BASE_SHA未知。不得用本地HEAD或最新CI成功SHA代替线上SHA。
- GitHub API可读。最近成功PR为其他分支；当前HEAD的历史PR失败，不作为本次验证结果，正式发布必须针对新提交重新通过所有CI门槛。
- 需取得可用SSH身份（仅提供密钥路径或既有SSH别名，不发送私钥）和线上RELEASE.json；据此确定base和迁移状态。
- CI失败不部署；manual review明确批准后才设置deployment_reviewed。记录commit/push对应页面追溯到本机桌面文档。
- 服务器按release-check、产物SHA、release id、迁移结果、5项service状态、健康及磁盘结果验收；本次发布通过不等于九项故障恢复验收全部通过。

审批依据：用户调用的 deploy-to-server SKILL.md Pause Conditions明确要求基础设施/发布脚本改动须人工审阅；仓库AGENTS.md要求对正式迁移及共享运行边界提供具体范围后批准。

## 用户“继续”后的服务器只读复核与追加范围

用户已批准以上审阅范围继续。发现本机现有SSH别名 `amazon-123`，已使用其已配置密钥访问123目标，无需新增凭据或修改SSH配置。默认直连失败不代表该别名不可用。

- 服务器实际release SHA：`98e5bcf8b3422ceb0721dd210be5fe2d2d05db41`；release id `20261106-080922-codex-amazon-multistore-mcp-98e5bcf8b3422ceb0721dd210be5fe2d2d05db41`。
- 只读观察五项服务active；磁盘50G、可用约31G。以上仅为观察时点状态，不代表发布验收。
- `_prisma_migrations`只读比较：98项已应用，未发现checksum/state不一致。
- 实际有7项待迁移。此前4项只覆盖未跟踪目录，漏算3项已提交但尚未在该主机应用的迁移。不能直接让migrate deploy顺带执行。

追加请求批准以下3项，与原4项合并后按迁移顺序执行：

1. `20261106040000_amazon_ads_advertiser_account_id`：AmazonAdsProfile新增可空advertiserAccountId及默认0的advertiserAccountRevision。
2. `20261106050000_amazon_catalog_listing_attributes`：AmazonCatalogSnapshot新增可空listingAttributes JSONB。
3. `20261106140000_sellfox_order_and_fba_shipment_snapshots`：新增SellfoxOrderSnapshot、SellfoxFbaShipmentSnapshot两张只读快照表及唯一键/查询索引，关联SellfoxStore，删除限制RESTRICT；不改ProductRecord、不回填、不发起同步。

完整待迁移顺序：040000、050000、060000、070000、140000、150000、170000（均为20261106前缀，对应上文完整目录名）。增量DDL可能持锁，迁移失败停止发布。回滚仍只涉及应用，不自动回滚数据库或删除新增数据。

追加范围未获批准前，不commit/push、不触发生产发布；没有修改服务器配置、数据库或进程。线上清单证据在本机 `/tmp/erp-production-migration-preflight.json`，不含凭据或原始业务数据。
