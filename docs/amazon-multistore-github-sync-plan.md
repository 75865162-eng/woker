# Amazon 多店铺 GitHub 同步审批方案

## 当前状态与具体目标

本地基线 HEAD 和逐文件 SHA-256 以同目录 `amazon-multistore-worktree-inventory.json` 为准。当前分支 `cursor/rebrand-tiaotiao-aa9a`；本次未切换分支、提交、推送或查询远端实时状态。

拟同步至现有 Git remote `origin`：`github.com/75865162-eng/woker`，新分支 `codex/amazon-multistore-mcp`。从清单记录的本地 HEAD 创建分支，提交该清单全部 `proposed_included` 内容，推送该分支并创建面向 main 的草稿 PR。不会合并 main，也不会触发生产 workflow_dispatch、写配置、迁移或部署。

创建草稿 PR 会按当前 `.github/workflows/ci-cd.yml` 的 pull_request 规则运行测试/lint/build/artifact 校验；生产部署仅允许 workflow_dispatch 且 deploy_production=true，草稿 PR 不具备该授权。发布环境与线上 BASE_SHA 必须另行确认。

## 完整改动区范围

JSON 清单覆盖当前全部已修改、已删除、未跟踪改动；包含此前同步中心阶段、Amazon 数据隔离、个人 MCP、文档、测试、SQL 和本次请求体修补，不能仅提交最后几个修改文件。

还发现两项独立的商品会议记录改动，已单独标记 `scope_confirmation_required`：

- `src/components/products/product-meeting-notes.tsx`：详情就绪后提前读取会议记录；有非空内容时按钮图标变红。会增加一次详情初始化读取，改变既有 UI 行为。
- `docs/product-domain-simple-architecture-plan.md`：对应会议记录行为文档。

本方案建议把这两项已存在改动也一并纳入同步，以保持完整工作区与 GitHub 对齐；需要用户明确批准这个完整范围。商品观察字段写入保护及对应 ProductRecord / draft 测试属于 Amazon 事实数据边界，仍列入 Amazon 关联改动。

现有 UI PNG 截图作为文档证据也在清单中，未静默丢弃。生成目录 `.next-amazon-live/` 按 AGENTS.md 构建产物排除规则留在本地，仅记录文件数量和大小，不纳入提交。忽略的 `.env*`、运行时 uploads、node_modules 等不属于提交内容，未读取或打包其内容。两份本方案及清单为派生审批文件，不对自身做递归内容哈希。

## 已完成的本地补齐

MCP 凭证管理原先在 body 限制前调用会 clone/parse body 的会话 helper；现已把流式字节上限、同源 JSON、对象校验放在认证 helper 前，并复用到店铺改名及 OAuth start。无 Content-Length 或伪造长度也不能绕过限制；非法 JSON 返回 400，超限 413，错误媒体类型 415，异源请求 403。

新增 Route 回归覆盖分块/多字节超长请求取消、无锁 reader 释放、非法 JSON、Origin；真实临时 PostgreSQL 会话验证三个管理入口仍保留当前用户、角色和工作区权限。验证结果见 `amazon-multistore-verification-2026-11-05.json`。

## 批准后的执行与停止条件

1. 比较当前 HEAD、完整 status 和清单哈希。发生范围变化就停止，不把新文件悄悄纳入已批准范围。
2. 仅按清单路径暂存，不使用 git add -A，不 stash/reset 用户改动，不提交生成目录或运行态配置。
3. 创建本方案命名分支与一个完整改动提交，推送 origin，再创建草稿 PR，核对 PR 文件清单与本地清单一致。
4. 等待 CI；失败修复代码或说明阻塞，不旁路本地/服务器生产构建、不自动上线。
5. CI 通过后回报草稿 PR 和产物；真实历史数据核查、OAuth 验收、服务器迁移发布仍按独立目标方案审批。

若用户希望排除独立会议记录改动，应先明确排除范围；不得通过 stash/恢复或静默漏交来制造两端不一致。尚未取得本具体同步方案的批准，因此本次只准备本地可审阅结果。
