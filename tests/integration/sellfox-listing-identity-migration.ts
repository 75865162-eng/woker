/** Explicit local DB check; normal npm test remains database-free. All DDL rolls back. */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const schema = `sellfox_g_test_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.connect(); await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    for (const table of ["SellfoxStore", "SellfoxSnapshotHead"]) await client.query(`CREATE TABLE "${table}" AS SELECT * FROM public."${table}" WITH NO DATA`);
    const columns = await client.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='SellfoxListingSnapshot' AND column_name NOT IN ('fnsku','parentSku','mainImage') ORDER BY ordinal_position`);
    const names = columns.rows.map(row => `"${row.column_name}"`).join(",");
    await client.query(`CREATE TABLE "SellfoxListingSnapshot" AS SELECT ${names} FROM public."SellfoxListingSnapshot" WITH NO DATA`);
    await client.query(`INSERT INTO "SellfoxStore" (id,"organizationId","workspaceId","externalId",name,marketplace) VALUES ('s','org','ws','124687','fixture','US')`);
    await client.query(`INSERT INTO "SellfoxListingSnapshot" (id,"organizationId","workspaceId","storeId","sourceKey","capturedAt",asin,msku,sku,payload) VALUES ('r','org','ws','s','source','2026-10-25T00:00:00Z','ASIN','MSKU','SKU','{}')`);
    await client.query(`INSERT INTO "SellfoxSnapshotHead" ("storeId",resource,"capturedAt") VALUES ('s','listings','2026-10-25T00:00:00Z')`);
    const prior = await readFile("prisma/migrations/20261025020000_sellfox_agent_read_models/migration.sql", "utf8");
    await client.query(prior.split("\n").find(line => line.startsWith("CREATE VIEW sellfox_listing_current"))!);
    const old = (await client.query('SELECT * FROM sellfox_listing_current')).fields.map(field => field.name);
    await client.query(await readFile("prisma/migrations/20261025040000_sellfox_listing_identity_image/migration.sql", "utf8"));
    const after = await client.query('SELECT * FROM sellfox_listing_current');
    assert.deepEqual(after.fields.map(field => field.name), [...old, "fnsku", "parentSku", "mainImage"]);
    assert.equal(after.rows[0].fnsku, null); assert.equal(after.rows[0].mainImage, null);
    await client.query(`UPDATE "SellfoxListingSnapshot" SET fnsku='FNSKU',"parentSku"='PARENT',"mainImage"='https://m.media-amazon.com/images/I/fixture.jpg' WHERE id='r'`);
    const narrow = (await client.query('SELECT fnsku,"parentSku","mainImage" FROM sellfox_listing_current')).rows[0];
    assert.equal(narrow.fnsku, "FNSKU"); assert.equal(narrow.parentSku, "PARENT");
    // Older application projection still reads after expansion.
    assert.equal((await client.query('SELECT id,msku FROM sellfox_listing_current')).rows[0].msku, "MSKU");
    // No complete Head means no current, even if rows were written.
    await client.query('DELETE FROM "SellfoxSnapshotHead"');
    assert.equal((await client.query('SELECT * FROM sellfox_listing_current')).rowCount, 0);
    await client.query("ROLLBACK");
    assert.equal((await client.query("SELECT to_regnamespace($1) AS value", [schema])).rows[0].value, null);
    console.log("Listing incremental migration, NULL defaults, narrow projection, old-reader compatibility and rollback: PASS");
  } finally { await client.query("ROLLBACK").catch(() => undefined); await client.end(); }
}
main().catch(() => { console.error("Listing migration validation failed; temporary transaction rolled back."); process.exitCode = 1; });
