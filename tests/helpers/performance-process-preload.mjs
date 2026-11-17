// Applied only to the explicitly named disposable performance database.
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";
import fs from "node:fs";
const db = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (db.hostname !== "127.0.0.1" || db.pathname !== "/erp_performance_fixture") throw Error("Disposable performance fixture required");
const local = host => ["localhost", "127.0.0.1", "::1", "::"].includes(host ?? "localhost");
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const input = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof input === "object" ? input?.host : typeof args[1] === "string" ? args[1] : "localhost";
  if (!local(host)) throw Error("External performance fixture socket forbidden");
  return Reflect.apply(connect, this, args);
};
tls.connect = () => { throw Error("External TLS forbidden in performance fixture"); };
const lookup = dns.lookup;
dns.lookup = function (host, ...args) { if (!local(host)) throw Error("External DNS forbidden"); return Reflect.apply(lookup, this, [host, ...args]); };
const read = fs.readFileSync;
fs.readFileSync = function (file, ...args) {
  if (typeof file === "string" && /(?:^|\/)\.env(?:\.|$)/.test(file)) throw Error("Dotenv reads forbidden in performance fixture");
  return Reflect.apply(read, this, [file, ...args]);
};
