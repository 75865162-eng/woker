import type { Worker } from "bullmq";
import { connectionIdentity } from "./connection-identity";

const connections = new Map<Worker, boolean>();
export function observeWorker(worker: Worker, label: string) {
  connections.set(worker, false);
  void worker.client.then(client => {
    connections.set(worker, client.status === "ready");
    client.on("ready", () => { connections.set(worker, true); });
    client.on("close", () => { connections.set(worker, false); });
    client.on("end", () => { connections.set(worker, false); });
  }).catch(() => { connections.set(worker, false); });
  worker.on("error", () => {
    connections.set(worker, false);
    console.error(`[${label}] queue unavailable; reconnecting; inspect persisted task state`);
  });
  worker.on("closed", () => { connections.set(worker, false); });
}

export function runtimeHeartbeatMetadata() {
  return {
    registration: process.env.ERP_WORKER_REGISTRATION ?? "legacy-unmanaged",
    version: process.env.ERP_RUNTIME_VERSION ?? "development",
    connectionIdentity: connectionIdentity(),
    queueReady: connections.size > 0 && [...connections.values()].every(Boolean),
  };
}
