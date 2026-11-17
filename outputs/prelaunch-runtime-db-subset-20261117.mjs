import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { migrationCatalog, migrationReadiness } from '../scripts/runtime/readiness-contract.mjs';
import { backupDatabase } from '../scripts/runtime/backup-postgres.mjs';
import { assertFixtureContainer } from '../scripts/runtime/fixture-safety.mjs';
const { Client } = createRequire(import.meta.url)('pg');
const root = process.cwd(), tag = randomUUID().slice(0, 8);
const directory = mkdtempSync(path.join(tmpdir(), 'erp-runtime-db-'));
const name = `erp-runtime-pg-${tag}`, log = path.join(root, 'outputs/prelaunch-runtime-20261117.log');
const checks = [];
let id, port, success = false;
const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const verify = () => assertFixtureContainer(JSON.parse(docker(['inspect', id]))[0], { id, name, tag, port, servicePort: 5432 });
async function sql(connectionString, text, values = []) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 2000 });
  try { await client.connect(); return await client.query(text, values); }
  finally { await client.end().catch(() => {}); }
}
try {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  id = docker(['run', '--pull=never', '-d', '--name', name, '--label', 'codex.task=erp-runtime-fixture', '--label', `erp.fixture.run=${tag}`, '--memory=512m', '--cpus=1', '-e', 'POSTGRES_PASSWORD=fixture_password', '-e', 'POSTGRES_DB=erp_fixture', '-p', `127.0.0.1:${port}:5432`, 'postgres:16-alpine']);
  verify();
  const env = { PATH: process.env.PATH, TMPDIR: directory, ERP_RUNTIME_MODE: 'production', NODE_ENV: 'production', __NEXT_PROCESSED_ENV: 'true', DATABASE_URL: `postgresql://postgres:fixture_password@127.0.0.1:${port}/erp_fixture` };
  const deadline = Date.now() + 60000;
  for (;;) {
    try { await sql(env.DATABASE_URL, 'SELECT 1'); break; }
    catch (error) { if (Date.now() > deadline) throw error; await new Promise(resolve => setTimeout(resolve, 300)); }
  }
  checks.push('PASS：本次创建的 PostgreSQL16 容器身份、标签、loopback 绑定及无 bind mount 校验通过');
  const migrationsRoot = path.join(root, 'prisma/migrations'), config = path.join(directory, 'prisma.config.ts');
  writeFileSync(config, `import { defineConfig } from ${JSON.stringify(pathToFileURL(path.join(root, 'node_modules/prisma/config.js')).href)}; export default defineConfig({schema:${JSON.stringify(path.join(root, 'prisma/schema.prisma'))},migrations:{path:${JSON.stringify(migrationsRoot)}},datasource:{url:${JSON.stringify(env.DATABASE_URL)}}});`);
  const migrate = () => {
    const output = execFileSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--config', config], { cwd: directory, env, encoding: 'utf8', timeout: 180000 });
    appendFileSync(path.join(directory, 'migration.log'), output);
  };
  migrate();
  const historySql = 'SELECT migration_name,checksum,finished_at,rolled_back_at,applied_steps_count FROM "_prisma_migrations" ORDER BY started_at,id';
  const history = (await sql(env.DATABASE_URL, historySql)).rows;
  const catalog = migrationCatalog(migrationsRoot), status = migrationReadiness(catalog, history);
  assert.equal(status.ok, true, status.detail);
  checks.push(`PASS：空库完整 migrate deploy；${status.detail}`);
  migrate();
  assert.deepEqual((await sql(env.DATABASE_URL, historySql)).rows, history);
  checks.push('PASS：重复 migrate deploy 后 Prisma 全历史逐项不变（名称/checksum/完成时间/回滚状态/步骤数）');
  await sql(env.DATABASE_URL, 'INSERT INTO "Organization" (id,name,slug,"updatedAt") VALUES ($1,$2,$3,now())', [`fixture-org-${tag}`, '迁移恢复隔离标记', `restore-${tag}`]);
  await sql(env.DATABASE_URL, 'CREATE TABLE fixture_restore_evidence (id integer PRIMARY KEY,payload text NOT NULL,amount numeric(20,4) NOT NULL)');
  await sql(env.DATABASE_URL, 'INSERT INTO fixture_restore_evidence VALUES (1,$1,12345.6789)', ['隔离恢复校验内容']);
  const organizations = (await sql(env.DATABASE_URL, 'SELECT id,name,slug FROM "Organization" ORDER BY id')).rows;
  const rows = (await sql(env.DATABASE_URL, 'SELECT * FROM fixture_restore_evidence ORDER BY id')).rows;
  const backup = await backupDatabase({ directory: path.join(directory, 'backups'), env, run: async (command, args) => {
    verify();
    if (command === 'pg_dump') writeFileSync(args.at(-1), execFileSync('docker', ['exec', id, 'pg_dump', '-U', 'postgres', '-d', 'erp_fixture', '--format=custom'], { maxBuffer: 64 * 1024 * 1024 }));
    else execFileSync('docker', ['exec', '-i', id, 'pg_restore', '--list'], { input: readFileSync(args.at(-1)), stdio: ['pipe', 'ignore', 'pipe'] });
  } });
  const dumpPath = path.join(directory, 'backups', backup.filename), dump = readFileSync(dumpPath);
  assert.equal(createHash('sha256').update(dump).digest('hex'), backup.checksum);
  assert.ok(readFileSync(dumpPath + '.sha256', 'utf8').startsWith(backup.checksum + '  '));
  checks.push(`PASS：复用 backupDatabase 完成 custom dump、pg_restore --list 与 SHA256；bytes=${backup.bytes} sha256=${backup.checksum}`);
  await sql(env.DATABASE_URL, 'CREATE DATABASE fixture_restore');
  verify();
  execFileSync('docker', ['exec', '-i', id, 'pg_restore', '-U', 'postgres', '--dbname=fixture_restore', '--exit-on-error'], { input: dump, stdio: ['pipe', 'ignore', 'pipe'], timeout: 180000 });
  const restored = env.DATABASE_URL.replace('/erp_fixture', '/fixture_restore');
  assert.deepEqual((await sql(restored, historySql)).rows, history);
  assert.deepEqual((await sql(restored, 'SELECT id,name,slug FROM "Organization" ORDER BY id')).rows, organizations);
  assert.deepEqual((await sql(restored, 'SELECT * FROM fixture_restore_evidence ORDER BY id')).rows, rows);
  assert.equal(migrationReadiness(catalog, (await sql(restored, historySql)).rows).ok, true);
  checks.push('PASS：pg_restore --exit-on-error 恢复到独立新库；Prisma 全历史、Organization 测试行、中文 payload 与 numeric 精度逐项一致');
  success = true;
} catch (error) {
  checks.push(`FAIL：${error.stack}`);
  process.exitCode = 1;
} finally {
  if (id) {
    try {
      verify(); docker(['rm', '-f', id]);
      assert.equal(docker(['ps', '-a', '--filter', `id=${id}`, '--format', '{{.ID}}']), '');
      checks.push('PASS：仅删除通过身份复核的本次临时容器，核验无残留');
    } catch (error) { success = false; process.exitCode = 1; checks.push(`FAIL：临时容器清理 ${error.message}`); }
  }
  appendFileSync(log, '\n2026-11-17 迁移/恢复独立子集实际执行\n' + checks.join('\n') + `\n子集结果：${success ? 'PASS' : 'FAIL'}；完整 runtime 仍 BLOCKED（Windows），未启动 web/worker。\n`);
  console.log(checks.join('\n'));
  console.log(`子集结果：${success ? 'PASS' : 'FAIL'}`);
  if (success) rmSync(directory, { recursive: true, force: true });
  else console.log(`失败日志保留：${directory}`);
}
