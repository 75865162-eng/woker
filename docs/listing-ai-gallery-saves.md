# Listing AI 图片工作区存档

`/listing-ai` 的 Images & A+ 图片表格标题改为名称输入框，右侧提供“保存”和“历史”。名称必填，最多 100 字；每次保存新增独立记录，同名不覆盖。历史列表每页 20 条，按保存时间倒序，第一列展示 75 × 75px 缩略图，其后展示名称、服务端登录账号名及北京时间。缩略图按 Image 行、从左到右取首张有效图片，沿用等比完整展示、懒加载、异步解码和失败占位规则；无图显示“暂无图片”。列表仅返回缩略图资源地址，不返回完整快照。点击记录确认后替换当前图片表格内容，不运行 AI 或发布 Listing。

存档包含所有竞品列、图片位置、自己的图片与逐行备注、表格文字及红字／黄底格式。仅恢复表格涉及的 input 字段，不替换标题生成器、聊天或其他页签。图片使用现有 FileObject/资源存储；数据库保存持久图片引用，不存 blob/data URL。缺失或无权访问的资源阻止保存或恢复，不默默丢图。

调用链：`GallerySaveControls` → `/api/listing-ai/gallery-saves` → `createGallerySaveService` → `gallerySaveRepository` → `ListingAiGallerySave`。查询与详情统一走该服务；GET 使用 listingAi/view，POST 使用 listingAi/edit。组织、用户来自服务端会话，workspace 沿现有解析及访问检查；存档按 organization/workspace/user 隔离，账号和时间不接受客户端指定。历史列表不返回完整快照。客户端恢复需 edit 权限；现有自动草稿不承担命名历史的事实源。

新增迁移：`prisma/migrations/20261116010000_listing_ai_gallery_saves/migration.sql`。2026-11-11 经用户单独批准，已在根 `.env` 对应的本机 Docker 数据库 `amazon_sync_live_local`（端口 55439）执行此迁移 SQL，并通过 Prisma migrate resolve 登记；未执行其他待迁移内容。已核验列、主键、隔离查询索引、用户外键、迁移 checksum 及 Prisma 只读查询。其他环境启用前仍须审核目标数据库和所有待执行迁移，再单独批准执行；不能直接批量运行 migrate deploy。只需新增存档表和索引，不改现有业务数据；回退应用时可保留该表，不执行删除数据回滚。

验证：`tests/listing-ai-gallery-saves.test.ts` 为无数据库 fixture 验证，覆盖多列/空行/图片引用/文字/格式往返、非法输入、服务端账号、每次新增及跨组织/工作空间/用户隔离。运行相关 ESLint、`npm run typecheck`、无连接 Prisma validate。本机数据库迁移及只读结构验证已完成；尚未进行真实登录、上传与保存恢复端到端联调，未写入测试业务记录。fixture 不代表真实业务验收。
