# Handoff v1
可审阅的 *.schema.json 与源码保持一致。六个 JSON schema 由 src/lib/agent-platform/handoff.ts 导出；运行时执行同源校验。payload 保留旧字段，_handoff 固定 version=1。旧格式仅兼容普通业务交接，不可作为 Launch 授权。所有全链 PPC 必须带 launchApproval 服务端引用；Launch 批准仅解锁建议。

LaunchTicket 用于获批后的 PPC 入站；PpcPlan 支持编排准备态。二者都不能用客户端字段自行授权。
