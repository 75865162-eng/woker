// Isolated registered Worker fixture: no root .env, no unmocked network.
import "./amazon-offline-network-guard.mjs";
import { readFileSync, appendFileSync, existsSync, writeFileSync } from "node:fs";
const file = process.env.AMAZON_PROMOTIONS_PROCESS_FIXTURE;
if (!file || process.env.AMAZON_SYNC_OFFLINE_FIXTURE !== "1") throw Error("Promotions fixture file required");
const fixture = JSON.parse(readFileSync(file, "utf8"));
const NativeDate = globalThis.Date;
const offset = () => Number(readFileSync(fixture.clock, "utf8"));
globalThis.Date = new Proxy(NativeDate, {
  construct(target, args, newTarget) { return Reflect.construct(target, args.length ? args : [NativeDate.now() + offset()], newTarget); },
  get(target, key) { return key === "now" ? () => NativeDate.now() + offset() : Reflect.get(target, key); },
});
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (init.method && init.method !== "GET" && url.hostname !== "api.amazon.com") throw Error("Only read fixture operations");
  if (url.hostname === "api.amazon.com") return Response.json({ access_token: "fixture", expires_in: 3600 });
  if (url.hostname !== "sellingpartnerapi-na.amazon.com") throw Error("Unexpected fixture host");
  appendFileSync(fixture.calls, JSON.stringify({ path: url.pathname, token: url.searchParams.get("paginationToken") }) + "\n");
  if (url.pathname === "/promotions/2025-12-01/promotions") return Response.json({ totalResults: 1, promotions: [fixture.detail] });
  if (url.pathname === "/promotions/2025-12-01/promotions/promo-one") return Response.json(fixture.detail);
  if (url.pathname.endsWith("/selections/selection-one")) {
    if (url.searchParams.has("paginationToken")) {
      if (!existsSync(fixture.release)) {
        writeFileSync(fixture.held, "held");
        await new Promise(() => {}); // Parent kills this specific Worker in-flight.
      }
      return Response.json({ selection: { type: "ITEMS", selectionId: "selection-one", revisionId: 1, selectionDetails: { items: [] } } });
    }
    return Response.json({ selection: { type: "ITEMS", selectionId: "selection-one", revisionId: 1, selectionDetails: { items: [{ asin: "B123456789", sku: "fixture-sku" }], pagination: { nextToken: "next" } } } });
  }
  throw Error("Unexpected fixture operation");
};
const interval = globalThis.setInterval;
globalThis.setInterval = (callback, delay, ...args) => interval(callback, delay === 30000 ? 500 : delay, ...args);
