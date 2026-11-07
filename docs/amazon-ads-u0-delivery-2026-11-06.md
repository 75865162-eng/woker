# Amazon Ads U0 本地交付：能力清单与迁移基线

状态：本地第一批代码已完成；不代表整个升级计划已完成或真实账号已启用。

## 交付内容

- `src/lib/amazon-ads/capabilities.ts`：SP/SB/SD 各 18 个数据域，分别记录读取实现、合同证据、端点/版本、存储、查询、UI、MCP、账号权限核验、真实验收和写入阻断。已有八类 SP 结构单独标记；Product Ad、Portfolio、SB/SD 实体不借用 SP 的完成状态。
- 五类 SP 报表只声明有通用已发布事实查询基础；具体合同、采集适配器和真实验收仍未完成。历史日期限制未知时保持 `null`，不使用猜测值。
- `scripts/amazon-ads-capabilities.ts`：只读输出 JSON 或 Markdown，没有 dotenv、数据库、凭证、网络或文件写入。清单尚未接到现有页面/MCP 响应，不改变其契约或运行闸门。`budget-bidding` 指额外设置域，不否认已有 Campaign 预算及 Ad Group 默认竞价字段。
- `scripts/test-amazon-ads-migrations.mjs` 与 `tests/fixtures/amazon-ads-migration.sql`：使用预装 PG 镜像、随机一次性容器、显式 Prisma 临时配置与真实 `migrate deploy` 验证 SQL 链，不再用 `db push` 替代本次迁移验收。

运行方式：

```bash
node node_modules/tsx/dist/cli.mjs scripts/amazon-ads-capabilities.ts --product=SP --markdown
node node_modules/tsx/dist/cli.mjs scripts/amazon-ads-capabilities.ts
node scripts/test-amazon-ads-migrations.mjs
```

迁移 runner 不接受目标库/环境参数；不继承 `DATABASE_URL`、dotenv、真实凭证或上传目录，不拉镜像，不挂载 volumes。仅临时占用一个最高 512 MiB / 1 CPU 的 PG 容器，退出时停止自己创建的容器并删除临时目录。Prisma 子进程有一分钟时限。它不修改 migration SQL、运行配置、现有数据库或服务。

## 实际验证

- 当前全仓 `tsc --noEmit --incremental false` 通过。上一轮发现的 `ads_viewer` 枚举错误已由工作区其他改动修复，本轮没有覆盖该修复或调整生产权限。
- 新增能力清单测试通过，覆盖 SP/SB/SD 区分、Product Ad 未实现、报告查询不冒充采集、两级 Negative 分离、未知历史限制与真实权限/写入阻断。
- 新增代码定向 ESLint 通过。
- 实际迁移链通过：先在一次性库迁到 `amazon_ads_query_foundation` 的前一版，然后分别验证无业务行的安装路径与有 legacy fixture 的升级路径。Prisma ledger 记录目标迁移成功；原 payload、version-less 事实和零值保留，nullable 指标可写入。
- 三种错误历史数据分别验证阻断：EntityRecord、ReportVersion、ReportFact 引用另一 Profile。迁移失败时不自动重新归属原行；失败迁移的处置/resolve 不在本 runner 范围，真实环境仍须人工审阅处理。
- 新约束验证包含实体/版本/事实跨 Profile 写入拒绝、同 Profile 下事实引用不同来源任务拒绝，以及 legacy 无版本事实重复键拒绝。

本轮没有重跑全仓核心回归、浏览器或生产构建：没有变更运行时 API/UI/worker/schema；新增静态清单、CLI 和隔离验证脚本的风险由定向测试、全仓类型、lint、真实迁移链覆盖。准备合码/上线时仍需盘点完整改动区并执行完整检查，不把当前结果当作其他并行改动已全部验证。

## 下一切片与边界

下一步见 `amazon-ads-u1-implementation-proposal-2026-11-06.md`：Campaign 日报采集的具体字段合同必须先有证据，不能从通用 Reports envelope 或 fixture 反推。现有读取/发布闸门继续保留。

本批不改已有 API/MCP/页面/worker，不新增 Prisma 模型、不改配置，不启动真实任务。回滚仅移除本批新增清单、CLI、runner、fixture、测试及文档；不删除持久数据。没有 commit/push、生产迁移或部署，桌面追溯规则尚未触发。整个工作区原有改动仍保持原样，U0 中最终 Git 同步和合码门禁尚未执行。
