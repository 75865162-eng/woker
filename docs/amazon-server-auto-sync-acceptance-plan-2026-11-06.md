# Amazon 自动同步：服务器交付与验收目标

## 用户最终明确的目标

最终交付是部署到服务器后，在服务器独立启动、运行和恢复 Amazon SP-API 同步，不依赖用户 Mac、浏览器或当前聊天。Mac 专用环境只用于此前已批准的真实账号开发验收，不作为最终运行基础。用户进一步明确：现在写好代码与部署衔接，以后推送部署即可自动同步；本轮不访问服务器、不提交推送、不部署，也不等待服务器 IP 确认。

## 已核实的仓库能力

- deploy/systemd/amazon-sync-worker.service 从 /opt/amazon-ad-bulk-current 启动 npm run worker:amazon-sync，读取 /opt/amazon-ad-bulk-operation/.env，并发 1；Restart=always、RestartSec=5、WantedBy=multi-user.target。
- scripts/server-artifact-release.sh 在首发时启用并启动同步服务；普通发布只在 deployment-plan.json 要求同步 Worker 重启时 enable/restart。服务配置修改随 CI 产物安装并 daemon-reload。
- docker-compose.yml 的 PostgreSQL / Redis 已配置 restart=unless-stopped 和持久卷；这不是本机临时容器的配置。
- 授权完成后的初始化及 Worker 启动/30 秒 tick 以服务端数据库保存的来源、计划、任务、加密游标恢复；Redis 投递是可恢复的任务通知。
- 现有 AMAZON_SYNC_CENTER_SCOPES 是精确组织/工作区执行边界；必须核实服务器真实 scope 并明确启用，不能照抄 amazon-live-local/default 或使用全局通配。

## 服务器执行范围（执行前需核实并批准）

仓库默认新服务器为 ubuntu@123.207.47.225，路径 /opt/amazon-ad-bulk-operation。旧服务器与 aecob.com 是另一数据集。必须确认真实 API 配置位于哪一台，以及真实组织/工作区，不能假定两台数据一致或迁移本地测试凭证/数据。

先只读核对线上 RELEASE.json / RELEASE-RESULT.json、systemd is-enabled/is-active、Docker restart 策略、数据库和 Redis 可达、授权及来源的脱敏状态、scope 开关；不输出凭证或原始业务数据。

盘点完整改动区后确认上线范围；当前有其他模块既有改动，禁止默默部分发布。经明确批准提交推送后，使用当前线上 SHA 作为 BASE_SHA，由 GitHub Actions 完成检查、构建、打包、校验及产物发布。没有 CI 成功不得切换到本机构建或服务器构建。不覆盖 .env、uploads、卷或真实账户。若需 scope 配置写入、依赖安装或迁移，分别列明实际内容和影响后批准。

## 真实服务器验收

1. 发布身份：CI SHA、产物 SHA256、服务器 RELEASE.json 一致；发布摘要成功。
2. 自启动：amazon-sync-worker enabled 且 active，当前 release 路径正确，并发 1；PostgreSQL / Redis 持久卷和重启策略符合现有部署。
3. 配置后自动同步：真实授权就绪后，无需打开浏览器点击同步，服务端自动生成合格来源、计划和首批任务；未授权站点/域明确阻断。
4. 故障恢复：经批准重启该 Worker，验证心跳恢复、无重复消费者、旧 fence 不能提交；已提交页与游标保留，任务继续推进。依赖服务重启/整机重启属于单独明确批准的验收操作，不为验收重启全部服务。
5. 部署恢复：切换 release 后同步服务读取同一运行态环境和数据库，计划不丢失、不重复创建、不重置历史进度。
6. 业务成功：按站点/数据域检查事实行数、发布版本、覆盖窗和错误；队列 completed、进程 active 都不等于全量采集成功。财务历史保留边界、报告 FATAL/400、跨站点结算归属等已知问题仍需修复，不将失败标成功。

回滚只回退应用 release、current 链接及本次运行配置；先阻止新请求再回退不兼容代码。保留数据库事实、加密游标、审计和卷，数据库迁移只向前。

## Mac 配置纠正记录

先前已批准的 Mac LaunchAgent 曾安装，但启动报 EX_CONFIG，未形成可用守护。用户明确纠正最终目标后已 bootout 并删除仅本次创建的 com.amazon-sync.live-local.worker.plist 和 scripts/amazon-sync-local-daemon.mjs，两个专用本地容器恢复原 restart=no；没有删除配置、卷、游标或事实。此前已批准的真实账号本地验收 Worker 恢复为独立后台运行，仅用于开发验收，不作为交付方案。

## 本轮已补齐的部署代码

- systemd 同步服务明确为全域自动数据同步服务，在 Unit 配置 StartLimitIntervalSec=0；保留 Restart=always / RestartSec=5，防止宿主机重启后 PostgreSQL/Redis 较慢导致启动重试额度耗尽而永久停机。
- BullMQ Worker 注册 error 监听，Redis 断连时只输出固定脱敏错误，保留客户端重连及数据库任务意图恢复路径；不将基础设施异常或队列完成冒充业务成功。
- 启动时若没有有效 AMAZON_SYNC_CENTER_SCOPES，明确输出 SP-API 自动同步未启用提示；不静默待机或放宽组织权限。
- .env.example 明确标准 Worker、并发 1 与精确 scope 配置；仅更改示例，不修改任何真实 .env。
- 现有 deployment-plan.mjs 已识别服务文件、Worker 入口和共享逻辑变化；systemd 文件变更会标记运行配置更新和人工审阅，CI 产物发布时安装配置、daemon-reload、enable 并重启同步 Worker。不另建发布链路。

### “以后部署即可自动同步”的前提

代码部署和真实账号配置是两个独立持久化边界。账号授权保存在目标服务器 PostgreSQL，解密密钥和精确 scope 保存在目标服务器受控 .env；Git push 和 CI artifact 不携带本地 .env、数据库、Redis 或凭证。

因此目标服务器只需先完成一次受控账号配置（或另行批准的迁移），并具备兼容迁移、相同密钥与正确 scope。之后普通版本部署和系统重启均复用这些运行态数据；无需重复点击同步，也无需 Mac 常驻。目标空库只有代码而没有账号授权时不能凭本地配置自动开始，这不通过打包密钥或扩大 scope 解决。

### 本轮验证与未执行项

运行 release-runtime / deployment-plan / amazon-production-boundaries 的隔离测试，验证同步服务 enable/restart、旧 release 拒绝、重启失败拒绝、依赖延迟下的重启配置、持久环境路径与组织/Worker 边界。另运行相关 ESLint 和 TypeScript。未运行完整 build/check、没有访问服务器、没有部署/重启真实服务器；真实账号数据域的未完成项仍以本地验收记录为准。
