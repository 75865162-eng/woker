# U1：SP Campaign 日报纵向切片实施方案

状态：可审阅的下一批方案，尚未实现。当前用户已要求开始升级，本批已先完成 U0 的本地能力清单与隔离迁移验证；本文列出下一批共享行为的具体边界，不授权真实 API、配置、任务或持久迁移。

## 必须先锁定的合同

现有 `reporting-contract.ts` 只核对通用 Reporting v1 envelope。不能据此推断 Campaign 日报字段，也不能将 `fixture_campaign` 或 `fixture-contract-only` 用于实际请求。

需形成可审阅证据：官方具体报告文档/模型版本和核验时间、端点、请求及字段组合、reportType/query/groupBy、Profile/地区与账号类型、日期/历史/延迟限制、traffic/conversion date、归因窗口、币种/时区、零行/缺字段/warnings、分页或分片、下载目标和压缩协议。Reporting v1 与 Reporting v3 的选择由这些证据决定；在合同不全时继续标记 UNVERIFIED，不开放实际 report stage。

本批没有访问官方外部 API 或重新抓取官方文档，因此不宣称该合同已核验。历史 Ads 通用文档不足的部分要显式补证，不能用固定 7 天归因或猜测列名消除缺口。

## 最小文件与行为范围

| 边界 | 拟实施内容 | 保留行为 |
| --- | --- | --- |
| `src/lib/amazon-ads/reporting-contract.ts` 及同域报告合同模块 | 逐报告、逐版本的白名单与 fixture，不把不同 API 产品混入同一 parser | 已有 envelope 校验和临时 URL 脱敏 |
| `sync-adapter.ts` / 同域报告 adapter | 注入 transport；create、poll、download 分操作，不假装一次调用完成全部报告 | 八类 SP 结构 reader、独立游标和只读默认 |
| `sync-service.ts` / `sync-processor.ts` / `sync-scheduler.ts` | 现有任务表内区分结构/报告任务范围，持久化阶段与预算；旧 checkpoint 兼容 | 结构任务仍明确在结构完成时结束，不隐式追加报告请求 |
| `repository.ts`、既有 ReportRequest/Document、FileObject/storage 服务 | 请求/原始响应/完整文件/分片的来源、哈希、大小与权限关联；二进制经 storage adapter | 不把磁盘路径作为业务引用；不在 MCP 返回原始正文或下载 URL |
| `report-publication.ts` | 将正式验证合同与 fixture manifest 明确分开，验证全部文件后原子发布 | 离线闸门、来源 task/Profile、fencing、幂等与历史版本 |
| `report-query.ts` / `query-service.ts` | 复用已发布事实查询，补齐合同需要的覆盖/警告表达 | 最新版本先选后筛选、同口径汇总、实时授权复查 |
| `ads-workspace.tsx` 与 Campaign 页面组件 | 一个 Campaign 只读列表/详情接线，结合当前结构和已发布日报 | 旧深链与显式 Demo 入口；未覆盖指标不置零 |
| 现有 Ads 只读 MCP | 同一查询服务输出，增加必要来源说明；默认不新增工具权限 | 凭证显式授权、实时组织/店铺/站点/Profile 交集 |

如现有模型不足以持久化安全范围/预算、原始证据或完整性，先列出具体 schema diff 和迁移，再决定是否新增字段；不在实现途中直接改共享模型。预算必须跨 dispatch/重试持久化，不能用进程内计数冒充运行预算。

## 性能、数据与回滚

- create/poll/download、回补与文件落库会新增请求、队列、数据库和存储开销。初期只做一个 Profile、一种报告、有界日期窗口；按合同定义行/字节/分片、轮询、并发与截止时间，所有数值作为可审阅测试策略，不称官方固定配额。
- 大文件需要有界处理，不能直接将 storage `getBuffer` 的全文件读取视为可处理任意报告；必要时先补最小流式边界并评估兼容性。
- 空报告不自动清空历史；缺失日期/分片/unknown warning 不当作完整。MIN/MAX 仅描述观察范围，不能代表缺日检查。
- 正式读取路径只消费已发布版本；跨币种、归因、时区和 API 合同不混合累计。结构快照与报告时点不同，页面必须展示各自来源时间。
- 回滚代码/新入口，不删除 Raw 或历史版本；保留旧结构 checkpoint 和八类同步能力。真实开关、任务、配置和迁移的停用/恢复按目标环境另审，不自动触碰。

## 离线验收场景

1. 一次性 PG/Redis、模拟 transport、临时 local storage；无 dotenv、真实凭证、外网或镜像拉取。
2. 请求创建 → 中间状态轮询 → 两个分片下载 → 原始文件/元数据 → 标准化 → staging → 原子发布。
3. 相同输入重试不重复创建事实/版本；未知创建结果先查状态，失败/取消/stale fence 不发布。
4. 下载过期、重定向越界、分片缺失、解压/行数/大小超限、合同与 Profile 不符均失败关闭。
5. 先发布初值，再发布归因修订；当前结果不重复累计，旧事实与原始文件可追溯；空报告按已验证合同处理。
6. 页面 Campaign 行、服务端 totals、详情、MCP 使用同口径；未同步/部分/零/null/授权失效分开呈现。
7. 真实采集仍关闭；浏览器与集成测试证明本地切片，不声称 Amazon 官方/账号验收已完成。

实现前须核对共享行为、存储增长、P95、回滚与验证方案已获明确批准，依据是仓库 `AGENTS.md` 的“全局影响预告”和“性能影响预告”；真实数据/配置/API 操作还受其“长期安全审批规则”单独约束。
