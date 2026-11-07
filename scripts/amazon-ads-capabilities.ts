import { adsCapabilityBlockers, listAdsCapabilities, type AdsCapabilityProduct } from "../src/lib/amazon-ads/capabilities";

// Read-only inventory. No dotenv, database, credentials, network or file writes.
const args = process.argv.slice(2);
if (args.some(arg => !["--markdown", "--product=SP", "--product=SB", "--product=SD"].includes(arg)) || args.filter(arg => arg.startsWith("--product=")).length > 1) {
  throw new Error("Usage: tsx scripts/amazon-ads-capabilities.ts [--markdown] [--product=SP|SB|SD]");
}
const product = args.find(arg => arg.startsWith("--product="))?.slice(10) as AdsCapabilityProduct | undefined;
const rows = listAdsCapabilities(product);
if (args.includes("--markdown")) {
  console.log("Code inventory only; NOT a live readiness or authorization decision.\n");
  console.log("| Product | Domain | Read | Acquisition | Contract | Storage | Query | Live acceptance | Blockers |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of rows) console.log(`| ${row.product} | ${row.domain} | ${row.read} | ${row.acquisition} | ${row.contract} | ${row.storage} | ${row.query} | ${row.liveAcceptance} | ${adsCapabilityBlockers(row).join(", ")} |`);
} else {
  console.log(JSON.stringify({ kind: "CODE_INVENTORY_ONLY", capabilities: rows.map(row => ({ ...row, blockers: adsCapabilityBlockers(row) })) }, null, 2));
}
