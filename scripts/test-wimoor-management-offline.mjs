import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const root = process.cwd(), name = `codex-wimoor-management-${randomUUID().slice(0, 8)}`;
const temporary = await mkdtemp(join(tmpdir(), 'wimoor-management-fixture-'));
const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function run(args, env) { return new Promise((resolve, reject) => { const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit' }); child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Fixture command exited ${code}`))); }); }
let started = false;
try {
  docker(['image', 'inspect', 'postgres:16-alpine']);
  docker(['run', '--pull=never', '--rm', '-d', '--name', name, '--label', 'codex.task=wimoor-management-fixture', '--memory=512m', '--cpus=1', '-e', 'POSTGRES_PASSWORD=fixture_password', '-e', 'POSTGRES_DB=amazon_sync_test', '-p', '127.0.0.1::5432', 'postgres:16-alpine']); started = true;
  const port = docker(['port', name, '5432']).split(':').at(-1);
  const database = `postgresql://postgres:fixture_password@127.0.0.1:${port}/amazon_sync_test`;
  // Allowlist only: no dotenv, inherited credentials, existing DB, API or Worker.
  const env = { PATH: process.env.PATH, TMPDIR: tmpdir(), DATABASE_URL: database, REDIS_URL: 'redis://127.0.0.1:1', AMAZON_SYNC_OFFLINE_FIXTURE: '1', AMAZON_ADS_ENTITY_HISTORY_ENABLED: '1' };
  let ready = false;
  for (let i = 0; i < 100; i++) { try { docker(['exec', name, 'pg_isready', '-U', 'postgres']); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
  if (!ready) throw new Error('Disposable PostgreSQL unavailable');
  // Build the existing schema without the new tables, then apply the exact new SQL.
  let schema = await readFile(join(root, 'prisma/schema.prisma'), 'utf8');
  for (const model of ['ProductCatalogEntry', 'AmazonAdsChangeDraft', 'AmazonAdsEntityHistory']) {
    schema = schema.replace(new RegExp(`model ${model} \\{[\\s\\S]*?^\\}`, 'm'), '');
    schema = schema.split('\n').filter(line => !new RegExp(`\\b${model}\\[\\]`).test(line)).join('\n');
  }
  const schemaPath = join(temporary, 'schema.prisma'), config = join(temporary, 'prisma.config.ts');
  await writeFile(schemaPath, schema);
  await writeFile(config, `import { defineConfig } from ${JSON.stringify(join(root, 'node_modules/prisma/config.js'))}; export default defineConfig({schema:${JSON.stringify(schemaPath)},datasource:{url:${JSON.stringify(database)}}});`);
  await run(['node_modules/prisma/build/index.js', 'db', 'push', '--config', config], env);
  const client = new pg.Client({ connectionString: database });
  await client.connect();
  try {
    for (const path of ['20261212010000_product_management_catalog', '20261212020000_ads_changes_and_history']) await client.query(await readFile(join(root, 'prisma/migrations', path, 'migration.sql'), 'utf8'));
  } finally { await client.end(); }
  await run(['--import', join(root, 'tests/helpers/amazon-offline-network-guard.mjs'), 'node_modules/tsx/dist/cli.mjs', '--test', '--test-concurrency=1', 'tests/integration/wimoor-management.integration.ts'], env);
} finally {
  if (started) { try { docker(['stop', '--time', '2', name]); } catch { console.error(`Unable to stop own fixture container ${name}`); } }
  await rm(temporary, { recursive: true, force: true });
}
