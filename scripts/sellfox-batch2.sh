#!/usr/bin/env bash
# Wait for the running sales pull to drain, then run the remaining Sellfox domains.
# Usage: bash scripts/sellfox-batch2.sh <organization-id> <workspace-id> <actor-user-id>
set -u
ORG="${1:?organization-id}"
WS="${2:-default}"
USER_ID="${3:?actor-user-id}"
cd "$(dirname "$0")/.." || exit 1
DB_URL=$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2-)

pending() {
  node -e '
const { Client } = require("pg");
const client = new Client({ connectionString: process.argv[1] });
client.connect().then(async () => {
  const r = await client.query("select count(*)::int n from \"SellfoxSyncRun\" where organizationId=$1 and workspaceId=$2 and status in ('queued','running')", [process.argv[2], process.argv[3]]);
  process.stdout.write(String(r.rows[0].n));
  await client.end();
}).catch(() => { process.stdout.write("error"); });
' "$DB_URL" "$ORG" "$WS"
}

for _ in $(seq 1 240); do
  n=$(pending)
  if [ "$n" = "0" ]; then break; fi
  sleep 60
done

node --import ./scripts/runtime/database-bootstrap.mjs node_modules/tsx/dist/cli.mjs scripts/sellfox-full-pull.ts \
  --organization-id="$ORG" --workspace-id="$WS" --actor-user-id="$USER_ID" \
  --resources=performance,fba_shipments,ads_report,ads_campaign,ads_ad_group,ads_placement,ads_targeting,ads_search_term \
  --days=7 --ad-types=sp
