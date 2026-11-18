# 123 发布准备（2026-11-18）

目标：123.207.47.225，现网基线 `c5951d4f01a65a8b8efa3204c9e231bc11f83cc5`（本次 SSH 只读 RELEASE.json 核实）。仅通过 GitHub Actions CI artifact 发布。生产发布尚待独立审批。

范围：全部当前源代码、测试、文档与性能证据，含赛狐同步按钮就地反馈、owner 权限目录、导航与八标签策略、美国 FBA 2026 费用手册和单位换算。排除 `.next-*` 临时构建产物，不删除原目录；不包含 `.env`、上传文件或运行态数据。

本地验证：2387 单测通过；lint 无错误（5 条既有 warning）；typecheck 和 UI guard 通过。此前 CI 两项测试依赖不存在的仓库 tmp 目录，已改用系统临时目录。生产构建由 CI 验证，不本机构建。已有 owner fixture 性能证据以 before / after-isolated 配对，历史性能记录不视为本次生产验收。

## 生产影响与审批

相对现网代码，锁文件、数据库、部署脚本、systemd 与 Caddy 均有差异。需审核后允许依赖安装和 deployment_reviewed；按 deployment-plan 切换 web 和全部注册 Worker。数据库操作只允许清单内迁移，先核对目标库实际已应用记录；不能由代码差异推断全部待执行。

金额浮点转 DECIMAL(20,4) 会改变精度并可能锁表，且先删除再重建依赖视图；工作区成员表不自动回填授权，可能影响普通成员访问。现有提案身份迁移遇到不兼容数据会主动失败。发布不能当成无风险页面更新。

代码差异内迁移：

- `prisma/migrations/20261115000000_sellfox_api_endpoints/migration.sql`
- `prisma/migrations/20261115010000_sellfox_endpoint_date_format/migration.sql`
- `prisma/migrations/20261118050000_money_float_to_decimal/migration.sql`
- `prisma/migrations/20261214230000_sellfox_sync_shards/migration.sql`
- `prisma/migrations/20261215000000_local_port_three_gaps/migration.sql`
- `prisma/migrations/20261215000000_user_preferences/migration.sql`
- `prisma/migrations/20261215010000_sellfox_safe_default/migration.sql`
- `prisma/migrations/20261216010000_sellfox_proposal_identity/migration.sql`
- `prisma/migrations/20261217010000_remove_observation_zero_defaults/migration.sql`
- `prisma/migrations/20261218010000_workspace_membership/migration.sql`
- `prisma/migrations/20261218020000_sales_plan_unknown_observations/migration.sql`
- `prisma/migrations/20261219000000_sellfox_store_access_grants/migration.sql`

## 执行与回滚

经独立批准且 CI 验收通过后，使用 workflow_dispatch，base_sha 为上述现网基线、target_host=123.207.47.225、deploy_production=true、deployment_reviewed=true、install_dependencies=true。禁止源码 rsync 或服务器构建。

发布前再次核对现网基线；若变更则重新生成计划。发布后读取 RELEASE-RESULT.json，核对 commit、健康检查、迁移结果和全部注册服务。失败只按现有流程回退应用与运行配置；数据库不自动回滚。真实业务同步与外部 API 验收不包含在本次发布中。
