# 应用发布版本

右上角使用 `yy/mm/dd/v主版本.次版本.累计更新号`，例如 `26/11/05/v0.0.12`。

- 日期来自 `RELEASE.json.builtAt`（现有发布脚本记录的发布开始时间），按 Asia/Shanghai 展示，不随浏览日期变化。
- 版本递增仍由 `scripts/server-artifact-release.sh` 执行：优先解析 `VERSION_STATE_FILE` 的 JSON；文件缺失、不可读、JSON 或版本无效时，读取 `CURRENT_LINK/RELEASE.json`。两者均无有效版本才从 `v0.0.1` 开始。
- 每次执行发布流程，末位加一，跨天不重置；不会因刷新页面、修改源码或重启本地开发服务而递增。原有发布失败/回滚时的版本状态写入时机不变，失败尝试可能占用版本号。
- 元数据保留独立的 `appVersion` 和 `builtAt` 字段；日期只用于展示，不改变版本状态格式。
- 本地没有发布元数据时保留 `v0.0.1`，不伪造发布日期；可沿用 `APP_RELEASE_METADATA_PATH` 指向隔离测试元数据。日期无效时只显示版本。
- 历史上若每次发布都写成 `v0.0.1`，本修复只能从当前可读版本继续递增，无法还原已丢失的累计次数。

## 验证与发布

`tests/release-version.test.ts` 纳入默认 `npm test`，使用临时 mock 文件，只提取版本函数，不执行发布流程。覆盖 JSON 空白、异常状态、当前版本恢复、递增和上海时区日期显示。配合 TypeScript、lint 和 `bash -n scripts/server-artifact-release.sh` 检查。

本地修复不代表已上线。后续发布涉及发布脚本变更，按 AGENTS.md 经人工审核与明确授权后使用 CI artifact 链路；不手工改写生产版本状态。回滚可恢复上述代码，现有元数据结构兼容旧代码，但旧的 JSON 解析问题也会重新出现。
