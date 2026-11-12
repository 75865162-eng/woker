# 货代委托与物流轨迹

当前头程计划 service/API/页面新增 `CREATE_FORWARDER_ORDER`、`APPEND_TRACKING`。本批每计划一张整批委托，记录货代、渠道、运输方式、目的地址、柜号、提单、船名航次/航班及带时区的截单/起运/到达预计时间。参考 Wimoor `amazon-boot/.../inbound/pojo/entity/ShipInboundTrans.java` 及 `ShipInboundTransHis.java` 的 company/channel/ordernum/arrivalTime 等运输字段和历史留存职责；不执行 Wimoor 程序，不声称复制了其全部状态规则。

新增 `FbaLocalForwarderOrder`、`FbaLocalTracking`；账单可选关联同计划同货代委托。租户复合外键、计划锁、实时 WMS edit/店铺授权/创建人检查、revision、请求哈希和审计复用既有服务。轨迹为不可覆盖的人工凭据，时间不可倒序或录入未来；发运须有装箱且全部计划数量已在公司仓出库，读取预占流水时加锁。送达锁定终态，记录不构成 Amazon 收货证据。取消计划同时取消尚未发运的委托，历史节点及账单保留；已发运不能取消。

验证使用独立临时 PostgreSQL 的完整迁移链、会话 HTTP、10 次并发重试、撤权、故障回滚和临时 Next/Chromium 全流程，相关 37 项规则测试及定向 lint 通过。全仓类型检查被其他并行改动中的 `ListingAiGallerySave_scope_name_key` 类型错误阻塞，本批货代文件无报告错误。根 `.env` 是现有本地库的唯一配置源；沿用本会话迁移授权，已将本次 `20261123010000_fba_local_forwarder_tracking` 应用至 `amazon_sync_live_local`。核验 Docker 镜像/端口与实际数据库 IP、两张新表、账单 nullable 关联字段、三个租户复合外键、迁移完成及校验和，原计划与账单数量不变；没有执行其他待迁移项。移除新操作入口即可停止写入，回退不删表、不删历史。

当前显示最近 50 条轨迹（每单上限 1000），尚无在线货代接口、拆票运输、运输资料更正或报关提交功能。本批两个对象完成不代表全部 38 对象完成。没有正式过账、Amazon 写入、生产部署或 Git 推送。
