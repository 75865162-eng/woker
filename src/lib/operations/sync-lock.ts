import { createRequire } from "node:module";

export type LockClient = {
  connect(): Promise<void>;
  query(sql: string, values: string[]): Promise<{ rows: { locked: boolean }[] }>;
  end(): Promise<void>;
};
const { Client } = createRequire(import.meta.url)("pg") as {
  Client: new (options: { connectionString: string | undefined }) => LockClient;
};

// A session lock spans external HTTP requests without holding a database transaction.
// A crashed process releases the lock when PostgreSQL closes its connection.
export async function withAmazonSyncLock<T>(scope: { organizationId: string; workspaceId: string; resource: string }, work: () => Promise<T>, createClient: () => LockClient = () => new Client({ connectionString: process.env.DATABASE_URL })) {
  const client = createClient();
  await client.connect();
  try {
    const key = JSON.stringify([scope.organizationId, scope.workspaceId, scope.resource]);
    const result = await client.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [key]);
    if (!result.rows[0]?.locked) return null;
    return await work();
  } finally { await client.end(); }
}
