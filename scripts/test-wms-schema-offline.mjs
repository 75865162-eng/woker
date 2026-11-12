// Disposable PostgreSQL only. Does not load .env or inherit application credentials.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { verifyOutboundSchema } from '../tests/integration/wms-outbound-schema.mjs';
import { verifyStocktakeSchema } from '../tests/integration/wms-stocktake-schema.mjs';
const { Client } = createRequire(import.meta.url)('pg');
const root = process.cwd(), tag = randomUUID().slice(0, 8);
const capacity = process.argv.includes('--capacity');
const stocktake = process.argv.includes('--stocktake');
const freezeBrowser = process.argv.includes('--freeze-browser');
const freeze = process.argv.includes('--freeze') || freezeBrowser;
const events = process.argv.includes('--events');
const transferBrowser = process.argv.includes('--transfer-browser');
const transfer = process.argv.includes('--transfer') || transferBrowser;
if (process.argv.slice(2).some(arg => !['--capacity', '--stocktake', '--events', '--freeze', '--freeze-browser', '--transfer', '--transfer-browser'].includes(arg))) throw Error('Only --capacity, --stocktake --events, --freeze --freeze-browser, --transfer and --transfer-browser are supported');
const dir = mkdtempSync(path.join(tmpdir(), 'wms-schema-fixture-'));
const name = `wms-schema-fixture-${tag}`, label = `wms-schema-${tag}`;
const docker = args => execFileSync('docker', args, { encoding: 'utf8', env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let created = false;
let redisCreated = false;
const redisName = `${name}-redis`;
let db;
try {
  docker(['image', 'inspect', 'postgres:16-alpine']);
  docker(['run', '--pull=never', '-d', '--name', name, '--label', `codex.fixture=${label}`, '--memory=512m', '--cpus=1', '-e', 'POSTGRES_PASSWORD=wms_fixture_password', '-e', 'POSTGRES_DB=wms_fixture', '-p', '127.0.0.1::5432', 'postgres:16-alpine']);
  created = true;
  const port = docker(['port', name, '5432/tcp']);
  assert.match(port, /^127\.0\.0\.1:\d+$/);
  const url = `postgresql://postgres:wms_fixture_password@${port}/wms_fixture`;
  for (let i = 0; i < 60; i++) {
    const candidate = new Client({ connectionString: url, connectionTimeoutMillis: 1000 });
    try { await candidate.connect(); db = candidate; break; } catch { await candidate.end().catch(() => {}); await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert.ok(db, 'temporary PostgreSQL ready');
  const env = { WMS_TRANSFER_BROWSER: transferBrowser ? "1" : "0", WMS_FREEZE_BROWSER: freezeBrowser ? "1" : "0", PATH: process.env.PATH, TMPDIR: dir, DATABASE_URL: url, CHECKPOINT_DISABLE: '1' };
  if (events || (!capacity && !stocktake && !freeze && !transfer)) {
    docker(['image', 'inspect', 'redis:7']);
    docker(['run', '--pull=never', '-d', '--name', redisName, '--label', `codex.fixture=${label}`, '--memory=128m', '--cpus=1', '-p', '127.0.0.1::6379', 'redis:7']);
    redisCreated = true;
    const redisPort = docker(['port', redisName, '6379/tcp']);
    assert.match(redisPort, /^127\.0\.0\.1:\d+$/);
    env.REDIS_URL = `redis://${redisPort}/0`;
    env.QUEUE_DRIVER = 'redis';
  }
  const schema = readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
  const before = schema.replace(/generator client \{[\s\S]*?\n\}\n/, '').replace(/enum WmsOutboundStatus \{[\s\S]*?\n\}/g, '').replace(/enum WmsStocktakeStatus \{[\s\S]*?\n\}/g, '').replace(/model Wms\w+ \{[\s\S]*?\n\}/g, '').replace(/^.*\bWms\w+\[\].*\n/gm, '').replace(/^.*\bWms\w+\??\s+@relation.*\n/gm, '');
  const beforePath = path.join(dir, 'before.prisma'); writeFileSync(beforePath, before);
  const config = path.join(dir, 'prisma.config.ts');
  writeFileSync(config, `import {defineConfig} from ${JSON.stringify(path.join(root,'node_modules/prisma/config.js'))}; export default defineConfig({schema:${JSON.stringify(beforePath)},datasource:{url:${JSON.stringify(url)}}});`);
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--config', config], { cwd: root, env, stdio: 'pipe' });
  const migration = readFileSync(path.join(root, 'prisma/migrations/20261114010000_wms_first_loop/migration.sql'), 'utf8')
    .replace('CREATE UNIQUE INDEX "ProductRecord_wms_scope_key" ON "ProductRecord"("organizationId", "workspaceId", "id");', '-- Already present in the current non-WMS schema.');
  await db.query(migration);
  const tables = await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'Wms%'`);
  assert.equal(tables.rowCount, 11);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname='public' AND indexname='ProductRecord_wms_scope_key'`)).rows[0].n, 1);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname LIKE 'Wms%check'`)).rows[0].n, 7);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='WmsMovement_immutable'`)).rows[0].n, 1);
  console.log('PASS: isolated baseline upgrade creates 11 scoped WMS tables, 7 checks and immutable movement trigger');
  await db.query(readFileSync(path.join(root, 'prisma/migrations/20261117010000_wms_stocktake_foundation/migration.sql'), 'utf8'));
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'Wms%'`)).rows[0].n, 14);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname LIKE 'Wms%check'`)).rows[0].n, 10);
  await db.query(readFileSync(path.join(root, 'prisma/migrations/20261118010000_wms_domain_events/migration.sql'), 'utf8'));
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'Wms%'`)).rows[0].n, 16);
  await db.query(readFileSync(path.join(root, "prisma/migrations/20261119010000_wms_location_freeze/migration.sql"), "utf8"));
  await db.query(readFileSync(path.join(root, "prisma/migrations/20261120010000_wms_outbound_foundation/migration.sql"), "utf8"));
  await db.query(readFileSync(path.join(root, "prisma/migrations/20261122010000_wms_rejected_return/migration.sql"), "utf8"));
  await db.query(readFileSync(path.join(root, "prisma/migrations/20261125010000_wms_outbound_reservation_link/migration.sql"), "utf8"));
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname='WmsReceiptLine_returnedQty_check'`)).rows[0].n, 1);
  await db.query(readFileSync(path.join(root, "prisma/migrations/20261128010000_wms_transfer_order/migration.sql"), "utf8"));
  await db.query(readFileSync(path.join(root, "prisma/migrations/20261129010000_wms_catalog_consumables/migration.sql"), "utf8"));
  execFileSync(process.execPath, ["--import", "./tests/helpers/wms-process-preload.mjs", "node_modules/tsx/dist/cli.mjs", transfer ? "tests/integration/wms-transfer.integration.ts" : freeze ? "tests/integration/wms-location-freeze.integration.ts" : events ? "tests/integration/wms-events.integration.ts" : stocktake ? "tests/integration/wms-stocktake.integration.ts" : capacity ? "tests/integration/wms-capacity.integration.ts" : "tests/integration/wms-first-loop.integration.ts"], {cwd:root,env:{...env,WMS_OFFLINE_FIXTURE:"1",AUTH_DRIVER:"database",AUTH_SECRET:"wms-isolated-fixture-secret-32-characters"},stdio:"inherit"});
  await verifyOutboundSchema(db);
  if (!capacity && !stocktake && !events && !freeze && !transfer) {
    for (const suite of ["wms-stocktake", "wms-events", "wms-location-freeze", "wms-transfer"]) execFileSync(process.execPath, ["--import", "./tests/helpers/wms-process-preload.mjs", "node_modules/tsx/dist/cli.mjs", `tests/integration/${suite}.integration.ts`], {cwd:root,env:{...env,WMS_OFFLINE_FIXTURE:"1",AUTH_DRIVER:"database",AUTH_SECRET:"wms-isolated-fixture-secret-32-characters"},stdio:"inherit"});
    await verifyStocktakeSchema(db);
  }
  await db.query('CREATE DATABASE wms_empty_fixture');
  const empty = new Client({ connectionString: url.replace('/wms_fixture', '/wms_empty_fixture') });
  await empty.connect();
  try {
    let reachedWmsMigration = false;
    for (const folder of readdirSync(path.join(root, 'prisma/migrations')).sort()) {
      if (!/^\d/.test(folder)) continue;
      const sql = readFileSync(path.join(root, 'prisma/migrations', folder, 'migration.sql'), 'utf8');
      try { await empty.query(sql); } catch (error) { throw new Error(`Empty migration failed at ${folder}: ${error.message}`); }
      if (folder === '20261114010000_wms_first_loop') reachedWmsMigration = true;
    }
    assert.ok(reachedWmsMigration, 'WMS migration was applied in the complete empty-database chain');
    assert.equal((await empty.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'Wms%'`)).rows[0].n, 23);
    assert.equal((await empty.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='PurchasePayment_immutable' AND NOT tgisinternal`)).rows[0].n, 1);
    assert.equal((await empty.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='PurchasePaymentRefund_immutable' AND NOT tgisinternal`)).rows[0].n, 1);
    console.log('PASS: complete migration chain including WMS applies to an empty isolated database');
  } finally { await empty.end(); }
} finally {
  await db?.end().catch(() => {});
  if (redisCreated) {
    assert.equal(docker(['inspect', '--format', '{{index .Config.Labels "codex.fixture"}}', redisName]), label);
    docker(['rm', '-f', redisName]);
  }
  if (created) {
    const actual = docker(['inspect', '--format', '{{index .Config.Labels "codex.fixture"}}', name]);
    if (actual !== label) throw new Error('Fixture identity mismatch; refusing cleanup');
    docker(['rm', '-f', name]);
  }
  rmSync(dir, { recursive: true, force: true });
}
