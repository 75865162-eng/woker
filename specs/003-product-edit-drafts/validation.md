# 实施验收与剩余风险

## 代码范围与原因

- product-edit-draft-repository.ts：单独 IndexedDB 草稿库、版本化身份键、每标签页会话记录、条件删除，避免跨用户/租户/工作区/SKU 或标签页覆盖。
- use-product-edit-draft.ts：350ms 防抖、串行写入、明确放弃时先停止定时器再等待已排队写入，避免删除后复活。刷新/卸载/pagehide 仅尽力 flush。存储失败显示提示，不阻断正式保存。
- product-workbench.tsx / product-workbench-data.ts：权威详情就绪后初始化、不再根据图片数量重置；恢复保留 baseRevision；保存异常上抛，成功清理；取消确认、暂时离开、冲突恢复、复合字段人工检查。保留图片 previewFileId。Excel 导入只产生未提交表单。
- video-plan / operations-progress：受控子表单，即时同步到主商品草稿；不自动正式保存。已上传文件逐个保留引用，后续上传失败不丢前面已成功的引用。
- product-attachment-activity / product-workbook-detail-sections：工作簿内部上传状态联动主编辑器；上传未完成时禁止保存、取消和暂时离开，避免引用尚未回填就关闭。
- product-edit-dialog / product-version-modal：应用内 Dialog 替代商品冲突及版本恢复的原生弹窗；历史恢复确认前读取权威 revision。
- app-shell 三个文件：透传已登录用户 organizationId，不从本地存储伪造租户身份。
- product-record-repository：保留实际数据库 updateMany CAS；拒绝旧编辑复活已删除商品；唯一键竞争后不再查询已被 PostgreSQL 中止的事务，正确返回冲突。
- video-plan API / audit versions API：必须携带客户端观察到的 revision，不再用服务端当前 revision 代替用户预期版本；保留事务及409契约。版本恢复提交后的队列/缓存异常不误报事务失败。
- upload routes / attachment-bindings / types：新增 previewFileId 引用贯通，防止已绑定预览被当作临时文件。
- image backfill：dry-run 不写对象存储；apply 要求显式组织和管理员身份，文件先登记 temporary，事实源走聚合事务及审计。保留旧合法图片引用，新增资源失败保留 orphan 清理依据。
- derived refresh：仅原子更新当前数据库行的 source/currentOwner/isOverdue；不读旧 payload 再整体写回，不修改事实版本；日志明确全库范围和列清单。

## 行为约定

刷新/意外退出/路由切换：保留草稿，重开后提示恢复或放弃。系统内取消：有修改则确认，继续编辑保留，放弃清理并退出。暂时离开：明确保留，不等同放弃。提交失败和409均保留；409加载最新只供查看，不覆盖表单；用户选择恢复修改后再手动保存。

## 自动化结果

- npm run test：91/91 通过（新增7项身份隔离、无IndexedDB、人工恢复、附件引用、实际更新CAS模拟、缺失版本/删除、唯一键竞争回归）。
- npm run test:products:browser：9/9通过；实际商品编辑器+真实 Chromium IndexedDB，API mock，不触碰数据库/存储。覆盖刷新恢复、确认放弃/继续、保存成功/失败、重复409、跨身份隔离、上传引用/视频恢复、取消与防抖竞争、还原修改、IndexedDB不可用降级、导入初始草稿、SKU及会话条件删除、工作簿上传等待边界。
- npm run lint、npx tsc --noEmit、npm run build：均通过；最终构建完成83个页面生成。git diff --check通过。不以构建成功替代真实数据库并发和生产性能验收。

## 尚未验证 / 风险

1. 未使用生产账号、生产PostgreSQL、R2或服务器。CAS测试含真实仓储函数但数据库为模拟；必须在隔离PostgreSQL上补双用户事务、回滚和版本/Outbox一致性验收。完整登录、列表筛选分页和生产权限端到端仍需测试账号。
2. 本地草稿不是跨设备备份；清浏览器数据、存储配额、隐私模式、崩溃时最后350ms/尚未提交的异步写入无法绝对保证。无beforeunload/unload删除逻辑，展示失败状态且保留内存。
3. 对象存储删除闭环仍不完整：现有worker将temporary超时转orphan但不物理删对象。历史正式版本与设备本地草稿引用对服务器不可见，不贸然GC；需独立引用保护/保留期设计。上传到对象存储成功但FileObject登记失败仍可能留下无记录对象，未引入大型补偿系统。
4. 老图片只有previewUrl无previewFileId的历史记录本次不做全量回填。未来任何GC必须先审计历史引用。过期草稿附件如已失效，正式保存仍由服务端校验拒绝并提示重新上传。
5. 冲突恢复只按用户实际修改的顶层字段重新应用，数组/对象整体恢复，明确人工核对，不做三方自动合并；同一复合字段中他人改动需用户检查后保留。
6. 每次打开详情增加一次权威详情请求以避免旧缓存/残缺列表壳写回；不改列表SQL/分页。草稿比较只处理当前表单，未取得1000/5000/10000 SKU及50用户P95基准。
7. 未部署、未执行维护脚本、未推送GitHub；无数据库migration。回滚代码不删除IndexedDB库、不恢复旧的无CAS接口；部署前检查所有工作区改动范围。spec-kit配置属于本机忽略文件，跟踪规格在specs目录。
8. 实施过程中工作簿组件另有图片加载回退/占位图识别改动出现，非本次草稿逻辑写入，已保留；验证覆盖当前合并工作区，不擅自切分或提交这些来源未确认的变更。
