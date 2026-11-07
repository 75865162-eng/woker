// Loaded before application imports. Reject every outbound socket except the
// runner-created loopback database/Redis. HTTP fixtures replace fetch in-process.
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import dns from "node:dns";

const database = new URL(process.env.DATABASE_URL ?? "http://fixture.invalid");
const redis = new URL(process.env.REDIS_URL ?? "http://fixture.invalid");
if (process.env.AMAZON_SYNC_OFFLINE_FIXTURE !== "1" || database.hostname !== "127.0.0.1" || redis.hostname !== "127.0.0.1" || database.pathname !== "/amazon_sync_test") throw new Error("Disposable offline fixture scope required");
const ports = new Set([Number(database.port), Number(redis.port)]);
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  const port = typeof options === "object" ? options?.port : options;
  const host = typeof options === "object" ? options?.host : typeof args[1] === "string" ? args[1] : "localhost";
  if (!ports.has(Number(port)) || !["127.0.0.1", "localhost", "::1"].includes(host ?? "localhost")) throw new Error("External network forbidden in Amazon offline tests");
  return Reflect.apply(originalConnect, this, args);
};
tls.connect = () => { throw new Error("TLS network forbidden in Amazon offline tests"); };
dgram.createSocket = () => { throw new Error("UDP network forbidden in Amazon offline tests"); };
const originalLookup = dns.lookup;
dns.lookup = function (host, ...args) {
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("External DNS forbidden in Amazon offline tests");
  return Reflect.apply(originalLookup, this, [host, ...args]);
};
globalThis.fetch = async () => { throw new Error("Unmocked HTTP forbidden in Amazon offline tests"); };
