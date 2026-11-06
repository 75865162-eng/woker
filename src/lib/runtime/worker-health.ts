import registry from "./worker-registry.json";
import { connectionIdentity } from "./connection-identity";

type Heartbeat = { queueName: string; status: string; lastSeenAt: Date; metadata?: unknown };
export function registeredWorkerHealth(heartbeats: Heartbeat[], now = new Date(), expectedVersion = process.env.ERP_RUNTIME_VERSION ?? "development", expectedConnection = connectionIdentity()) {
  return registry.map(item => {
    const matches = heartbeats.filter(h => h.queueName === item.heartbeatQueue).sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
    const heartbeat = matches[0];
    const online = matches.filter(h => h.status === "online" && now.getTime() - h.lastSeenAt.getTime() <= 90_000 && h.lastSeenAt.getTime() <= now.getTime() + 5000);
    const active = online[0] ?? heartbeat;
    const meta = active?.metadata && typeof active.metadata === "object" ? active.metadata as Record<string, unknown> : {};
    const version = typeof meta.version === "string" ? meta.version : null;
    const metadata = online.map(h => h.metadata && typeof h.metadata === "object" ? h.metadata as Record<string, unknown> : {});
    const mismatchedInstances = metadata.filter(value => value.version !== expectedVersion).length;
    const mismatchedConnections = expectedConnection ? metadata.filter(value => typeof value.connectionIdentity === "string" && value.connectionIdentity !== expectedConnection).length : 0;
    const connectionMatches = mismatchedConnections ? false
      : expectedConnection && metadata.length && metadata.every(value => value.connectionIdentity === expectedConnection) ? true : null;
    const queueReady = metadata.some(value => value.queueReady === false) ? false
      : metadata.length && metadata.every(value => value.queueReady === true) ? true : null;
    return {
      id: item.id, label: item.label, queues: item.queues,
      online: online.length > 0, instances: online.length,
      lastSeenAt: active?.lastSeenAt ?? null,
      queueReady,
      version, versionMatches: online.length > 0 && mismatchedInstances === 0,
      mismatchedInstances,
      connectionMatches, mismatchedConnections,
    };
  });
}
