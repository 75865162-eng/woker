# 验证路线

本地运行 npm run test、npm run lint、npx tsc --noEmit、npm run build；独立浏览器测试运行 npm run test:products:browser（需本机已有Playwright Chromium，使用mock API，不需登录）。

图片回填默认 dry-run，可用 npm run products:backfill-image-assets -- --organization-id=<id> --workspace-id=<id> 缩小扫描。只有明确授权的维护任务才执行 --apply --organization-id=<id> --actor-user-id=<有效管理员ID>，不能用商品历史编辑者冒充本次操作者。本次未运行该脚本。

测试账号登录后打开商品：修改名称/工作簿/视频/图片引用，等待暂存状态，刷新并重开同 SKU，恢复后不应有正式 revision 变化。取消→继续编辑，随后取消→放弃；刷新确认没有草稿、正式数据不变。保存成功清草稿，模拟500仍保留。

双账号同 revision：A 保存成功，B 保存409；B 加载最新、核对、恢复修改、手动保存。B 处理期间让 A 再次保存，应再次409。新商品同 SKU 竞争不得覆盖已存在商品。切换账号、租户、工作区及 SKU 不可恢复别人的草稿。

上传附件后刷新恢复不得重新发上传请求；取消不删除已绑定对象。验证正常列表过滤/分页及保存后刷新。真实 PostgreSQL 竞争、对象存储和浏览器交互需独立测试环境，不对生产执行维护脚本或破坏性测试。
