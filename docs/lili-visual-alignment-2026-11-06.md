# Lili 视觉统一（2026-11-06）

范围：仅 `src/components/lili/` 的视觉样式与对应隔离浏览器验证。以商品详情使用的全局设计变量和 Card / Button / 商品字段样式为基准，不修改商品模块或全局 CSS。

- 字体继承主系统，正文 14px，配置字段标签 12px，区块标题 16px，页面标题 20px。
- 主操作和选中导航使用 `--brand`，辅助文字使用 `--muted`；卡片使用 `--border`、8px 圆角和轻阴影，按钮与输入框为 6px 圆角、40px 高度。
- 配置卡片标题增加分隔线，高级配置使用浅灰底；只读、禁用、焦点和结果提示保留清晰的视觉状态。
- 同步统一技能、工作流、工具目录和详情的旧暖色配色；保留告警和成功状态色。
- 入口、字段、说明文字、折叠交互、状态和事件处理器保持原样；不修改 API、配置值、存储、权限或外部执行行为。

验证：`npm run typecheck`；`npx eslint src/components/lili tests/browser/lili.spec.ts`；`npx playwright test --config tests/browser/lili.config.ts`。浏览器全部请求被 fixture 拦截，配置保存与连接测试仅使用内存模拟，不访问数据库或真实上游。覆盖原有目录、工具、配置读写与重试，以及主题色、控件尺寸、390px 横向溢出和高级配置可达性；截图在 `tmp/lili-config-desktop.png`、`tmp/lili-config-mobile.png`，不提交。

回滚：恢复本次 Lili 样式及 TSX 中的视觉 className 修改即可，无数据迁移。未运行完整构建、生产检查或真实配置测试；合码/上线时按仓库规则执行完整验证。本次未 commit、push 或部署，工作区已有其他任务改动不纳入本次同步。
