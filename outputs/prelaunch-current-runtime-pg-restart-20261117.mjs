import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { assertFixtureContainer } from '../scripts/runtime/fixture-safety.mjs';
const { Client } = createRequire(import.meta.url)('pg');
const root = process.cwd(), tag = randomUUID().slice(0, 8), name = `erp-runtime-pg-${tag}`;
const directory = mkdtempSync(path.join(tmpdir(), 'erp-runtime-restart-'));
const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let id, port;
const verify = () => assertFixtureContainer(JSON.parse(docker(['inspect', id]))[0], { id, name, tag, port, servicePort: 5432 });
async function sql(url, statement) {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try { await client.connect(); return await client.query(statement); }
  finally { await client.end().catch(() => {}); }
}
try {
  docker(['image', 'inspect', 'postgres:16-alpine']);
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = String(server.address().port);
  await new Promise(resolve => server.close(resolve));
  id = docker(['run', '--pull=never', '-d', '--name', name, '--label', 'codex.task=erp-runtime-fixture', '--label', `erp.fixture.run=${tag}`, '--memory=512m', '--cpus=1', '-e', 'POSTGRES_PASSWORD=fixture_password', '-e', 'POSTGRES_DB=erp_fixture', '-p', `127.0.0.1:${port}:5432`, 'postgres:16-alpine']);
  verify();
  console.log(`本次临时容器 ${id} ${name} port=${port}`);
  const env = { PATH: process.env.PATH, TMPDIR: directory, ERP_RUNTIME_MODE: 'production', NODE_ENV: 'development', __NEXT_PROCESSED_ENV: 'true', DATABASE_URL: `postgresql://postgres:fixture_password@127.0.0.1:${port}/erp_fixture`, STORAGE_DRIVER: 'local', UPLOAD_DIR: path.join(directory, 'uploads'), AUTH_DRIVER: 'database', AUTH_SECRET: 'isolated-runtime-fixture-secret-at-least-32-characters', ERP_RUNTIME_EXECUTION_FIXTURE: '1', ERP_RUNTIME_FIXTURE_PG_CONTAINER: name, ERP_RUNTIME_FIXTURE_PG_ID: id, ERP_RUNTIME_FIXTURE_TAG: tag };
  const deadline = Date.now() + 90_000;
  for (;;) {
    try { await sql(env.DATABASE_URL, 'SELECT 1'); break; }
    catch (error) { if (Date.now() > deadline) throw error; await new Promise(resolve => setTimeout(resolve, 300)); }
  }
  const config = path.join(directory, 'prisma.config.ts');
  writeFileSync(config, `import { defineConfig } from ${JSON.stringify(pathToFileURL(path.join(root, 'node_modules/prisma/config.js')).href)}; export default defineConfig({schema:${JSON.stringify(path.join(root, 'prisma/schema.prisma'))},migrations:{path:${JSON.stringify(path.join(root, 'prisma/migrations'))}},datasource:{url:${JSON.stringify(env.DATABASE_URL)}}});`);
  execFileSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--config', config], { cwd: directory, env, stdio: 'inherit' });
  await sql(env.DATABASE_URL, `INSERT INTO "Organization" (id,name,slug,"updatedAt") VALUES ('fixture-org','Fixture','runtime-fixture',now()); INSERT INTO "WorkspaceScope" ("organizationId",id,name,"isDefault","updatedAt") VALUES ('fixture-org','default','Fixture',true,now()); INSERT INTO "User" (id,email,name,"passwordHash","updatedAt") VALUES ('fixture-user','fixture@example.invalid','Fixture','placeholder',now()); INSERT INTO "OrganizationMember" (id,"organizationId","userId",role,"updatedAt") VALUES ('fixture-member','fixture-org','fixture-user','owner',now());`);
  execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--test', '--test-concurrency=1', '--test-name-pattern=PostgreSQL restart', 'tests/integration/runtime-faults.integration.ts'], { cwd: root, env, stdio: 'inherit' });
} catch (error) {
  console.error(error.stack);
  if (id) { verify(); console.error(docker(['logs', '--tail', '60', id])); }
  process.exitCode = 1;
} finally {
  if (id) { verify(); docker(['rm', '-f', id]); assert.equal(docker(['ps', '-a', '--filter', `id=${id}`, '--format', '{{.ID}}']), ''); console.log('本次临时容器经身份复核已清理且无残留'); }
  rmSync(directory, { recursive: true, force: true });
}
