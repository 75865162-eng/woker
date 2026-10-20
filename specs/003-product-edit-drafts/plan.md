# 实施计划：商品编辑草稿与并发保护

日期：2026-10-20；规格：[spec.md](spec.md)；范围：full。

## Summary

最小范围修复商品编辑生命期。IndexedDB repository + React hook 管理本地草稿，现有编辑器复用统一应用内 Dialog；保存继续经过现有聚合事务。视频策划作为主表单子编辑器，不再自动正式写入。

## Technical Context

TypeScript strict、React 19、Next.js 15、Prisma/PostgreSQL；浏览器 IndexedDB 保存本地数据。使用 node:test/tsx、ESLint、tsc 和 Next production build。仅扫描当前编辑商品，350ms 防抖，不增加服务端请求或列表全量加载。支持上千 SKU，不复制整个商品列表到草稿。

## Constitution Check

仓库 constitution 尚为模板，按 AGENTS.md 约束：最小改动、事实源唯一、Draft First、CAS、同事务审计/版本/Outbox、无凭据持久化、禁止无授权部署。设计前后均通过，无新增基础设施。

## Project Structure

- src/lib/products/product-edit-draft-repository.ts：身份隔离、版本化存储、手动恢复辅助。
- src/components/products/use-product-edit-draft.ts：防抖、恢复候选、串行写入/清理、离开保留。
- src/components/products/product-edit-dialog.tsx：复用应用内 HTML Dialog。
- product-workbench / video / version modal：交互与提交状态。
- 视频及版本恢复 API：客户端 revision 契约。
- image backfill / derived refresh：维护脚本安全边界。
- tests/product-edit-draft.test.ts 及并发回归：无密钥基础测试。
- specs/003-product-edit-drafts：需求、决策、测试路线与剩余风险。

## Implementation sequence

本地仓储 → 编辑器集成 → 写入入口修复 → 维护脚本 → 测试及回归。无 schema migration。回滚代码即可；不要删除浏览器草稿库或服务器文件。上线前真实双用户 PostgreSQL 与浏览器验收不能由 mock 测试替代。
