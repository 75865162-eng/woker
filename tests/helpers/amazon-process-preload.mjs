// Process-only disposable fixture. Never imported by application/runtime code.
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";
import { readFileSync } from "node:fs";
const env = process.env, db = new URL(env.DATABASE_URL ?? "http://invalid");
if (env.AMAZON_SYNC_PROCESS_FIXTURE !== "1" || env.AMAZON_SYNC_OFFLINE_FIXTURE !== "1" || db.hostname !== "127.0.0.1" || db.pathname !== "/amazon_sync_test"
  || !env.AMAZON_SYNC_FIXTURE_HTTP || !env.AMAZON_SYNC_FIXTURE_CLOCK) throw Error("Disposable process fixture required");
const allowedPorts = new Set([db.port, new URL(env.REDIS_URL).port, new URL(env.AMAZON_SYNC_FIXTURE_HTTP).port, env.AMAZON_SYNC_FIXTURE_WEB_PORT].map(Number));
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const a = Array.isArray(args[0]) ? args[0][0] : args[0];
  const port = typeof a === "object" ? a?.port : a;
  const host = typeof a === "object" ? a?.host : typeof args[1] === "string" ? args[1] : "localhost";
  if (!allowedPorts.has(Number(port)) || !["127.0.0.1", "localhost", "::1"].includes(host ?? "localhost")) throw Error("External socket forbidden in process fixture");
  return Reflect.apply(connect, this, args);
};
tls.connect = () => { throw Error("TLS forbidden in process fixture"); };
const lookup = dns.lookup;
dns.lookup = function (host, ...args) {
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw Error("External DNS forbidden in process fixture");
  return Reflect.apply(lookup, this, [host, ...args]);
};
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (["api.amazon.com", "sellingpartnerapi-na.amazon.com", "fixture.s3.amazonaws.com"].includes(url.hostname)) {
    return nativeFetch(env.AMAZON_SYNC_FIXTURE_HTTP + "/amazon", { method: "POST", headers: { "content-type": "application/json", "x-fixture-key": env.AMAZON_SYNC_FIXTURE_KEY },
      body: JSON.stringify({ url: url.href, method: init.method ?? "GET", body: init.body ? String(init.body) : null }), signal: init.signal });
  }
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) || !allowedPorts.has(Number(url.port))) throw Error("Unmocked HTTP forbidden");
  return nativeFetch(input, init);
};
const NativeDate = globalThis.Date;
const offset = () => Number(readFileSync(env.AMAZON_SYNC_FIXTURE_CLOCK, "utf8"));
globalThis.Date = new Proxy(NativeDate, {
  construct(target, args, newTarget) { return Reflect.construct(target, args.length ? args : [NativeDate.now() + offset()], newTarget); },
  get(target, property) { return property === "now" ? () => NativeDate.now() + offset() : Reflect.get(target, property); },
});
// Same registered recovery loop, shorter polling only in disposable processes.
const interval = globalThis.setInterval;
globalThis.setInterval = (callback, delay, ...args) => interval(callback, delay === 30000 ? 500 : delay, ...args);
