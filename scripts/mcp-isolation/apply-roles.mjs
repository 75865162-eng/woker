#!/usr/bin/env node
/**
 * Provision the two read-only Postgres roles used by the MCP servers.
 *
 *   mcp_amazon_ro  -> SELECT on Amazon*/SellerAccount/AmazonAds* tables
 *   mcp_sellfox_ro -> SELECT on Sellfox* tables only
 *
 * Run once per database, as a role that may create roles:
 *   MCP_SELLFOX_RO_PASSWORD=... MCP_AMAZON_RO_PASSWORD=... npm run mcp:roles
 *
 * Nothing is dropped. Re-running is idempotent (roles are created only when
 * missing; grants are additive). It prints the connection strings to put into
 * MCP_PG_READONLY_URL (sellfox) and AMAZON_MCP_PG_READONLY_URL (amazon).
 */
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const roles = [
  { name: "mcp_sellfox_ro", password: process.env.MCP_SELLFOX_RO_PASSWORD, prefixes: ["Sellfox"] },
  { name: "mcp_amazon_ro", password: process.env.MCP_AMAZON_RO_PASSWORD, prefixes: ["Amazon", "SellerAccount", "AmazonAds"] },
];

function dsnWithRole(url, role, password) {
  const parsed = new URL(url);
  parsed.username = role;
  parsed.password = password;
  return parsed.toString();
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  const { rows: dbRows } = await client.query("SELECT current_database() AS name");
  const database = dbRows[0].name;
  for (const role of roles) {
    if (!role.password || role.password.length < 16) {
      console.error(`${role.name}: set ${role.name === "mcp_sellfox_ro" ? "MCP_SELLFOX_RO_PASSWORD" : "MCP_AMAZON_RO_PASSWORD"} (>=16 chars).`);
      process.exitCode = 1;
      continue;
    }
    const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role.name]);
    if (!exists.rowCount) {
      await client.query(`CREATE ROLE "${role.name}" LOGIN PASSWORD '${role.password.replaceAll("'", "''")}'`);
      console.log(`created role ${role.name}`);
    } else {
      await client.query(`ALTER ROLE "${role.name}" WITH LOGIN PASSWORD '${role.password.replaceAll("'", "''")}'`);
      console.log(`updated password for ${role.name}`);
    }
    await client.query(`ALTER ROLE "${role.name}" SET default_transaction_read_only = on`);
    await client.query(`ALTER ROLE "${role.name}" SET statement_timeout = '30s'`);
    await client.query(`ALTER ROLE "${role.name}" NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    await client.query(`REVOKE ALL ON DATABASE "${database}" FROM "${role.name}"`);
    await client.query(`GRANT CONNECT ON DATABASE "${database}" TO "${role.name}"`);
    await client.query(`GRANT USAGE ON SCHEMA public TO "${role.name}"`);
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "${role.name}"`);
    const { rows: tables } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND (${role.prefixes.map((_, index) => `tablename LIKE $${index + 1}`).join(" OR ")})`,
      role.prefixes.map(prefix => `${prefix}%`),
    );
    for (const table of tables) await client.query(`GRANT SELECT ON public."${table.tablename}" TO "${role.name}"`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO "${role.name}"`);
    console.log(`${role.name}: SELECT on ${tables.length} tables`);
    console.log(`  DSN: ${dsnWithRole(databaseUrl, role.name, role.password)}`);
  }
  console.log("\nSet these in .env (server-only), then restart the app:");
  console.log("  MCP_PG_READONLY_URL=<mcp_sellfox_ro DSN>");
  console.log("  AMAZON_MCP_PG_READONLY_URL=<mcp_amazon_ro DSN>");
} finally {
  await client.end();
}
