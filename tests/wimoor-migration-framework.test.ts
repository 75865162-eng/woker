/**
 * WIMOOR 页面功能迁移框架契约测试。
 * 静态校验数据层/页面层/API 层遵守架构红线：
 *  1. 租户隔离：所有查询/写入带 scoped(scope)
 *  2. 幂等：写走 upsert，不裸 create
 *  3. 不造数：无 seed/fixture 默认数据注入
 *  4. 审计：记录 createdBy/updatedBy
 *  5. 鉴权：API 走 requireApiPermission
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function read(path: string) { return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'); }

const service = read('src/lib/wimoor-migration/master-data-service.ts');
const workbench = read('src/components/wimoor-migration/master-data-workbench.tsx');
const route = read('src/app/api/wimoor/master-data/route.ts');
const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/20261125000000_wimoor_page_migration_base/migration.sql');

test('数据层导出 entries/documents 的查询与变更函数', () => {
  for (const fn of ['queryEntries', 'mutateEntries', 'queryDocuments', 'mutateDocuments']) {
    assert.match(service, new RegExp(`export async function ${fn}\\b`), `缺少 ${fn}`);
  }
});

test('架构红线：所有数据访问带租户隔离 scoped(scope)', () => {
  const scopedCalls = (service.match(/\.\.\.scoped\(scope\)/g) ?? []).length;
  assert.ok(scopedCalls >= 6, `scoped(scope) 调用过少：${scopedCalls}`);
  assert.match(service, /function requireScope\(scope/);
});

test('架构红线：写操作幂等 upsert，不裸 create 覆盖', () => {
  const upserts = (service.match(/\.upsert\(/g) ?? []).length;
  assert.ok(upserts >= 2, `upsert 调用过少：${upserts}`);
  // 停用是软删除，不物理 delete
  assert.match(service, /status: "INACTIVE"/);
  assert.doesNotMatch(service, /\.delete\(\)/);
});

test('架构红线：不造数——无默认种子数据', () => {
  assert.doesNotMatch(service, /seed|fixture|createMany\(\[\{/i);
});

test('架构红线：审计字段 createdBy/updatedBy 落地', () => {
  assert.match(service, /createdBy: scope\.actorUserId/);
  assert.match(service, /updatedBy: scope\.actorUserId/);
});

test('schema：通用主数据/单据表含唯一键与租户字段', () => {
  assert.match(schema, /model MasterDataEntry/);
  assert.match(schema, /model MasterDataDocument/);
  assert.match(schema, /@@unique\(\[organizationId, workspaceId, kind, code\]/);
  assert.match(schema, /@@unique\(\[organizationId, workspaceId, kind, docNo\]/);
});

test('迁移SQL：建表带租户唯一索引（幂等 IF NOT EXISTS）', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "MasterDataEntry"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "MasterDataDocument"/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "MasterDataEntry_key"/);
});

test('API：GET view / POST create / 状态流转 approve 鉴权', () => {
  assert.match(route, /requireApiPermission\("operations", "view"/);
  assert.match(route, /requireApiPermission\("operations", needApprove \? "approve" : "create"/);
  assert.match(route, /workspaceScopeFromRequest\(request\)/);
});

test('页面框架：配置驱动含搜索/新增/表格/分页/弹窗完整交互', () => {
  assert.match(workbench, /DataTable<Row>/);
  assert.match(workbench, /WorkbenchPagination/);
  assert.match(workbench, /<Dialog/);
  assert.match(workbench, /openAdd|openEdit/);
  assert.match(workbench, /placeholder=\{f\.placeholder/);
  assert.match(workbench, /config\.extraFilters/); // 更多条件筛选
});

test('页面框架：租户 header 从 localStorage 工作区作用域读取', () => {
  assert.match(workbench, /amazon_bulk_ad_workspace_scope/);
  assert.match(workbench, /x-workspace-id/);
});

test('迁移完整性：128 个菜单全部有登记，链接页文件真实存在', () => {
  const registry = read('src/lib/wimoor-migration/page-registry.ts');
  const entryCount = (registry.match(/l1: '/g) ?? []).length;
  assert.equal(entryCount, 128, '登记册应含 128 个菜单');
  const linkedCount = (registry.match(/localHref: '\//g) ?? []).length;
  assert.ok(linkedCount >= 115, `链接页过少：${linkedCount}`);
  // 抽查每个链接的页面文件存在
  const hrefs = [...registry.matchAll(/localHref: '(\/wimoor\/[^']+)'/g)].map(m => m[1]);
  for (const href of hrefs) {
    const file = `src/app/(erp)${href}/page.tsx`;
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `页面文件缺失：${file}`);
  }
});

test('架构红线：所有页面为客户端组件并复用通用工作台', () => {
  const root = new URL('../src/app/(erp)/wimoor/', import.meta.url).pathname;
  let checked = 0;
  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === 'page.tsx' && !p.endsWith('/wimoor/page.tsx')) {
        const txt = readFileSync(p, 'utf8');
        if (txt.includes('MasterDataWorkbench')) {
          assert.match(txt, /'use client'/, `${p} 缺少 use client`);
          assert.match(txt, /源组件|源 Vue|WIMOOR/, `${p} 缺少源组件注释`);
          checked++;
        }
      }
    }
  }
  walk(root);
  assert.ok(checked >= 90, `复用通用工作台的页面过少：${checked}`);
});
