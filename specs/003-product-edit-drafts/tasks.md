# 实施任务

顺序依赖：T001 → T002/T003 → T004 → T005 → T006。先保证正式写入安全，再验收浏览器体验。不需要并行 agent 或新基础设施。

## Setup 与本地草稿（US1）

- [x] T001 整理审计、spec/plan/research/data-model/contracts/quickstart。
- [x] T002 在 src/lib/products/product-edit-draft-repository.ts 与 use-product-edit-draft.ts 实现隔离、防抖、恢复及失败保护。
- [x] T003 在 product-workbench.tsx 实现刷新保留、取消确认、保存后清理及409人工恢复。

## 写入安全（US2）

- [x] T004 收口 video-plan、operations-progress 子表单；修复 video API、版本恢复及图片 preview 引用。
- [x] T005 修复 backfill-product-image-assets.ts 聚合写入和 dry-run；明确 refresh-product-derived-fields.ts 原子派生更新边界。

## 验证和交付（US3）

- [x] T006 增加草稿/并发回归测试，运行 test/lint/typecheck/build，记录未覆盖风险。
- [x] T007 真实 Chromium + mock API 浏览器回归（恢复/取消/附件），不触碰生产。
- [ ] T008 隔离 PostgreSQL 双用户竞争、事务回滚及完整登录/列表筛选分页端到端验收；需要隔离数据库/测试账号。
