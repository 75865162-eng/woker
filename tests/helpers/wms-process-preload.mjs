// Test-only guard: no inherited credentials, no external network, no root dotenv reads.
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import fs from 'node:fs';
const db = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (process.env.WMS_OFFLINE_FIXTURE !== '1' || db.hostname !== '127.0.0.1' || db.pathname !== '/wms_fixture') throw Error('Disposable WMS fixture required');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
 const a=Array.isArray(args[0])?args[0][0]:args[0];
 const host=typeof a==='object'?a?.host:typeof args[1]==='string'?args[1]:'localhost';
 if (!['127.0.0.1','localhost','::1'].includes(host ?? 'localhost')) throw Error('External WMS fixture socket forbidden');
 return Reflect.apply(connect,this,args);
};
tls.connect=()=>{throw Error('TLS forbidden in WMS fixture');};
const lookup=dns.lookup;
dns.lookup=function(host,...args){if(!['127.0.0.1','localhost','::1'].includes(host)) throw Error('External DNS forbidden');return Reflect.apply(lookup,this,[host,...args]);};
const read=fs.readFileSync;
fs.readFileSync=function(file,...args){if(typeof file==='string' && /(?:^|\/)\.env(?:\.|$)/.test(file)) throw Error('Dotenv read forbidden in WMS fixture');return Reflect.apply(read,this,[file,...args]);};
