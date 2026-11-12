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
    const recovery = meta.recovery && typeof meta.recovery === "object" ? meta.recovery as Record<string, unknown> : null;
    const lastRecovery = typeof recovery?.lastSuccessAt === "string" ? Date.parse(recovery.lastSuccessAt) : NaN;
    const spApi = recovery?.spApi && typeof recovery.spApi === "object" ? recovery.spApi as Record<string, unknown> : null;
    const lastRecoveryError = typeof recovery?.lastErrorAt === "string" ? Date.parse(recovery.lastErrorAt) : NaN;
    const recoveryReady = item.id !== "amazon-sync" ? null : !Number.isFinite(lastRecovery) || !spApi ? null
      : online.length > 0 && queueReady === true && mismatchedInstances === 0 && connectionMatches === true
        && now.getTime() - lastRecovery <= 120_000 && lastRecovery <= now.getTime() + 5000
        && (!Number.isFinite(lastRecoveryError) || lastRecoveryError < lastRecovery)
        && spApi.dispatchFailures === 0 && spApi.maintenanceFailures === 0;
    return {
      id: item.id, label: item.label, queues: item.queues,
      online: online.length > 0, instances: online.length,
      lastSeenAt: active?.lastSeenAt ?? null,
      queueReady,
      version, versionMatches: online.length > 0 && mismatchedInstances === 0,
      mismatchedInstances,
      connectionMatches, mismatchedConnections,
      recoveryReady,
      recovery: item.id === "amazon-sync" && recovery ? { lastSuccessAt: recovery.lastSuccessAt ?? null, lastErrorAt: recovery.lastErrorAt ?? null, inProgress: recovery.inProgress === true, adsHealthy: recovery.adsHealthy ?? null,
        examined: spApi?.examined ?? null, dispatched: spApi?.dispatched ?? null, dispatchFailures: spApi?.dispatchFailures ?? null, expiredLeases: spApi?.expiredLeases ?? null, automaticRecoveries: spApi?.automaticRecoveries ?? null, authorizationRecoveries: spApi?.authorizationRecoveries ?? null, maintenanceFailures: spApi?.maintenanceFailures ?? null } : null,
    };
  });
}
