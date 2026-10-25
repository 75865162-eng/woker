# ERP CLI

无 Cookie 的商品主档 CLI。它直连 PostgreSQL，使用现有 `ProductRecord`、`saveProductAggregate`、revision、审计和 Outbox；默认 dry-run，只有 `--write` 才写库。

## 安装与环境

在仓库根目录安装依赖：

```bash
pnpm install
export DATABASE_URL='postgresql://...'
export ERP_ORGANIZATION_ID='组织 ID'
export ERP_ACTOR_USER_ID='有 products:create/edit 权限的用户 ID'
```

`SELECTION_ORGANIZATION_ID` / `SELECTION_ACTOR_USER_ID` 可作为兼容别名。操作者必须是 active organization member，且角色权限包含所需的 `products:create`、`products:edit` 或 `products:view`。

## 命令

```bash
pnpm erp -- products upsert --file draft.json
pnpm erp -- products upsert --file draft.json --write
cat draft.json | pnpm erp -- products upsert --write --file -
pnpm erp -- products get --sku DEMO-001 --workspace default
```

最小 `draft.json`：

```json
{
  "version": 1,
  "sku": "DEMO-001",
  "title": "测试商品",
  "marketplace": "US",
  "workspace": "default",
  "englishName": "Demo Product",
  "asin": "B000000000",
  "meta": { "source": "agent" },
  "imagePaths": ["/tmp/demo.jpg"]
}
```

输出始终是 stdout 上的一行 JSON：`{ ok, dryRun, sku, productId?, errors[], warnings[] }`。人读日志写 stderr。未知字段会报错；扩展数据必须显式放进 `meta`。`imagePaths` 本轮不会上传，输出 `IMAGES_NEED_UPLOAD`，也不会伪造 `fileId`。

选品 `selection-pipeline --write` 仍保留其证据质量门禁和专用 SKU 分配。选品流程可以继续调用它，也可以在已有共享 service 的边界上调用本 CLI；本 CLI 不绕过权限、审计或 ProductRecord 事务。

## 输入合同与更新行为

可复制 [draft.example.json](draft.example.json)；机器可读字段定义见 [draft.schema.json](draft.schema.json)，运行时另检查空白必填值、别名冲突和 fixture。支持的字段取自 `Product` / ProductWorkbench，包括尺寸、重量、供应商、关键词、图片资产、专利、视频和运营进度；未知顶层或嵌套字段报错，扩展键只放 `meta`。错误类型不做隐式转换。`title` / `品名` / `chineseName` 同时出现须一致，`workspace` / `workspaceId` 同理。

SKU 按组织 + 工作区定位。新建默认 `pending`，ID 由商品聚合生成；新建不要传 `id` 或 `revision`。已有 SKU 只更新显式提供字段，保留其余字段；数组和嵌套业务对象按整个字段替换，`meta` 按顶层键合并。可从 get 取得 `revision` 并随更新传回；版本过期返回 `REVISION_CONFLICT`。省略 revision 时基于本次事务读到的版本做 CAS，不自动重试冲突。

已有工作区的 marketplace/accountId 不允许被 CLI 改写；输入冲突会失败。缺失工作区沿现有 aggregate 边界创建。dry-run 校验身份、创建/编辑权限、字段、工作区和状态转换，不初始化角色、不写商品/审计/Outbox。附件实际存在性、归属、绑定冲突仍由 `--write` 时的聚合事务校验；dry-run 成功不是预留 SKU 或保证后续提交成功。

本地 `imagePaths` 仅产生 `IMAGES_NEED_UPLOAD`；不会读取本地图片、保存这些路径、调用上传接口或生成 fileId。已有 `imageAssets` 等附件引用须来自正确组织/工作区，保存时走原附件校验。

写入后处理既有持久化 Outbox，以建立 Dashboard 使用的 Summary/Text 投影。返回 `OUTBOX_PROCESSING_PENDING` 表示主档已提交、派生处理需恢复，不能视为“未写入”；可用 get 核验，正常 worker 继续恢复事件。写入有审计和 revision；本 CLI 不提供删除/数据库回滚，不自动撤销已提交数据。

CLI 从当前进程读取环境变量，不自动加载 `.env`。需要文件加载时可直接运行：

```bash
node --env-file=.env --import tsx scripts/erp-cli/src/cli.ts products upsert --file scripts/erp-cli/draft.example.json
```

Agent 要获取纯 JSON stdout，可用 `pnpm --silent erp -- ...` 或 `npm --silent run erp -- ...`，也可直接使用上面的 node 入口。没有凭据、fixture、无权限或失败均非 0 退出。默认权限模型与网页角色/旧权限配置一致；CLI 的只读权限查询不会初始化角色记录。数据库原始诊断不输出到 JSON，避免泄露连接信息。

选品流程若改为调用本 CLI，仍须先执行原质量门禁；通用 CLI 不代替评论/供应商/图片证据验收。当前 selection create 保持原实现，两者均复用 `saveProductAggregate`，没有修改选品写入路径。

## 验证

```bash
# 无数据库的 schema / stdin / 错误输出测试
node --import tsx --test tests/erp-cli*.test.ts

# Docker 独立临时 PostgreSQL，创建后销毁，不使用调用方 DATABASE_URL
npm run test:erp

# 类型检查
npm run typecheck
```

集成测试覆盖 dry-run 零写入（包括角色初始化）、create/get、Summary/Text、审计、薄 JSON 更新、版本冲突、fixture 和权限拒绝。测试不读取或重置现有数据库。未连接生产、未做真实账号 Dashboard 浏览器验收；部署/真实写库需另按环境执行。
