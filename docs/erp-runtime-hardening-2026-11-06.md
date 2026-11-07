# 统一运行环境增量完善

日期：2026-11-06（北京时间）。不修改真实配置、不停止现有真实进程、不执行 migration 或部署。现有未提交改动保留。

## 第三轮补齐：连接目标诊断与隔离类型清理

- 在数据库心跳在线之外，注册卡片增加网页与 Worker 连接目标比较。服务端以 AUTH_SECRET 为 HMAC 密钥，对数据库 host/port/path、Redis 协议/host/port/index、QUEUE_DRIVER 生成内部比较值；忽略 URL 用户名和密码，不把连接串或内部比较值返回浏览器。
- 所有在线实例都参与比较：任何实例不一致即提示；旧版无标记、缺少必要配置或离线为尚未确认。AUTH_SECRET 不同同样会导致不一致，提示应先核对整套配置。地址相同不证明 SSH tunnel、代理或 DNS 后为同一实际实例，仍需配置切换审批中的实例身份核对。
- 集成脚本结束仅恢复自己写入的 next-env.d.ts 路由引用，保留并行编辑及原始基线，防止新增引用指向已删除 fixture dist。原基线已含历史临时引用，本轮没有删除活跃构建目录或修改真实运行配置来掩盖冲突。
- 更新运维文档，明确并行开发保留的 amazon-live-approved 临时配置分支尚未退役，避免误称所有历史配置已经统一。

验证：全量 npm run test 在新增多实例断言前为 1,076 项全部通过；补充多实例/未知状态断言后，runtime-unification 专项 17 项通过。相关 TS/MJS 定向 ESLint 通过；排除多 dist 生成 validator 的临时源代码类型检查通过。标准 npm run typecheck 仍失败，错误为 .next-amazon-live / .next-dev 与 .next-build 的 LayoutRoutes 冲突，不能声明 check:fast 全通过。未重复生产构建。

隔离集成 14 条验收通过，覆盖四类 Worker 与网页一致连接目标、页面错误清除、任务消费、停止离线、重启、父进程强杀、Redis 中断/队列丢失恢复、数据库重启和临时备份恢复。只操作自建 fixture，容器与临时 dist 已清理，tsconfig 无测试残留。真实配置切换、running 租约/fence、服务器部署与自动备份启用仍未执行。

回滚：撤回连接诊断模块、心跳元数据字段、健康汇总/UI 和测试清理辅助代码即可；无 schema 变更，不需要恢复数据库。该回滚仅说明源码范围，不授权停止真实进程或部署。

## 第二轮补齐：心跳停止顺序与页面可信状态

- 四类 Worker 共用 `createHeartbeatWriter`：重叠在线写入合并为同一个 Promise，减少故障时堆积；停止写入等待已在途在线写入结束（失败也继续尝试 stopping），停止请求后不再创建任何 online 写入。原有心跳表、轮询频率、组织权限与调度逻辑不变。
- 仍无法承诺断库时立即写入停止：数据库不可达时按 90 秒超时显示离线，父管理器保留原有超时结束策略；不添加心跳兜底在线或自动改数据库。
- 设置运维页采用请求序号防止迟到响应覆盖当前状态，组件卸载后不再应用旧响应；读取失败时清除历史健康数据，避免继续把上次在线结果当成当前事实。失败时不误报 inline 队列模式。
- 隔离 Chrome 验证健康 API 返回 503 后旧注册卡片清除，恢复读取后重新显示当前四项心跳。

第二轮验证：首轮 `npm run check:fast` 返回成功，1,074 个测试通过。首次 lint 包含六条既有警告和一条本轮新增 ref 清理警告；本轮警告已修正，针对所有本轮 TypeScript 改动的 ESLint 再检查 0 error / 0 warning。但隔离 dev 退出并移除临时生成类型后，最终标准 `npm run typecheck` 再次出现 `.next-amazon-live` / `.next-dev` 与 `.next-build` 的 LayoutRoutes 冲突；不能将首轮成功视为最终标准类型检查通过。用临时配置排除多 dist 生成 validator 做源代码检查，不删除活跃目录或修改现有 tsconfig。合码前仍需一致生成类型环境/CI 验证。

`npm run test:runtime:integration` 本轮通过 14 条记录，覆盖真实四类子进程、网页心跳、健康读取失败、停止离线、重启、父进程 SIGKILL、Redis 停机期间提交后恢复、数据库重启及临时备份恢复。不是生产验收，不覆盖导入/图片 running 任务租约或真实外部接口。隔离容器、进程和临时 distDir 已清理，tsconfig 无本次临时路径残留。

回滚只需撤回心跳包装器接入和设置页面请求保护；无需数据库/配置回滚，测试与业务原始文件不受影响。生产构建仍留给获批合码/CI 发布，未执行 commit、push 或部署。

## 本次修复

- 管理器与子 Worker 使用 IPC。管理器崩溃/被 SIGKILL 时，子进程感知断开并向自己发送 SIGTERM，25 秒仍未结束则 SIGKILL，避免继续消费旧代码任务。只影响管理器拥有的子进程，不扫描或停止其他进程。start/stop 幂等，阻止重复启动和重复停止信号。
- 导入/图片任务先保存数据库意图和输入，再尝试队列投递。Redis 投递失败/等待超时返回新增 `dispatchDeferred: true`，不把任务误改 failed，也不删除可能被消费者使用的文件。导入保留 200、图片保留 202 以及原 job/batch 字段；queued 状态表示等待后续 Worker 恢复。
- 图片文件或数据库创建本身失败仍走原失败处理；只改变持久化成功后的运输失败边界。不自动重放 running，不调整任务授权。
- Queue 生产者使用有限重试并禁止离线命令无限堆积；阻塞 Worker 保持原连接恢复策略。投递延迟或晚成功仍依赖原 jobId/CAS，不能把超时理解为取消消息。
- 心跳汇总检查所有在线实例，旧版本进程不能被最新心跳遮住；任何实例明确连接异常时显示异常。异常未来时间不计在线。

回滚以上代码恢复原入口及接口逻辑，不更改数据库结构；实际运行切换仍需单独进程范围审批。运行中任务租约/fencing 的后续方案未实施，不因本次完善而变成已验收。

## 验证

- `npm run test:runtime:integration` 通过：临时 PostgreSQL/Redis、Chrome、真实网页/API/四类 Worker。新增管理器 SIGKILL 后四个子 PID 消失且心跳 stopping；Redis 停机时上传/图片 API 保留 queued 与原文件；重启后两类任务均恢复消费且图片输入未删除。继续覆盖正常停止、重复管理器、PG 重启及备份恢复。测试仅处理自己创建的资源，结束已清理容器和临时 distDir。
- `npm run check:fast` 中 1,069 个测试通过，lint 0 error / 6 条原有 warning。最初的新增测试回调类型声明已修正。随后标准 typecheck 发现 `.next-amazon-live`/`.next-dev` 与 `.next-build` 生成路由 LayoutRoutes 不一致，不能声明完整 check:fast 通过；不清理活跃运行目录或改写现有 tsconfig 掩盖该问题。另用临时 tsconfig 排除多套生成目录验证应用/脚本/测试源代码。
- 合码前须在一致生成类型环境重新执行标准 typecheck/CI 完整构建。未执行生产构建、外部业务请求或服务器验收。

## 仍需单独处理

1. 根 `.env` 配置切换及匹配数据库/Redis/密钥核对，见 `erp-runtime-local-config-cutover-approval.md`。本次未重新查询真实库，因此不复述历史计数为当前事实。
2. 导入/图片 running 租约、fence 和最终发布事务，见 `erp-runtime-recovery-follow-up-approval.md`。
3. 已有其他改动引入的 `ERP_LOCAL_INTEGRATION_PROFILE=amazon-live-approved` 显式临时联调分支仍存在；本次保留它及对应测试，不声称所有历史特殊配置都已删除。正式统一前需协调其使用者完成迁移/退役，不能擅自改变正在使用的目标。
4. 真实备份定时启用、服务器配置发布及重启验收仍未执行。
