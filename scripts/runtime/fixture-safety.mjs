import assert from "node:assert/strict";
import path from "node:path";

export function assertFixtureContainer(inspected, { id, name, tag, port, servicePort }) {
  assert.match(tag, /^[a-f0-9]{8}$/);
  assert.equal(inspected.Id, id, "临时容器 ID 已变化，拒绝操作");
  assert.equal(inspected.Name, `/${name}`);
  assert.equal(inspected.Config.Labels["codex.task"], "erp-runtime-fixture");
  assert.equal(inspected.Config.Labels["erp.fixture.run"], tag, "不是本次创建的临时容器");
  const bindings = inspected.HostConfig.PortBindings[`${servicePort}/tcp`];
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].HostIp, "127.0.0.1");
  assert.equal(bindings[0].HostPort, String(port));
  assert.equal(inspected.HostConfig.NetworkMode === "host", false);
  assert.equal(inspected.HostConfig.Privileged, false);
  assert.equal((inspected.Mounts ?? []).some(mount => mount.Type === "bind"), false);
}

export function fixtureEnvironment({ inherited = {}, directory, pgPort, redisPort, webPort, guard }) {
  assert.ok(path.isAbsolute(directory));
  for (const port of [pgPort, redisPort, webPort]) assert.ok(Number.isInteger(Number(port)) && Number(port) > 0 && Number(port) <= 65535);
  return {
    PATH: inherited.PATH, TMPDIR: directory, ERP_RUNTIME_MODE: "production", NODE_ENV: "production",
    __NEXT_PROCESSED_ENV: "true", NODE_OPTIONS: `--import=${JSON.stringify(guard)}`,
    ERP_FIXTURE_ALLOWED_PORTS: [pgPort, redisPort, webPort].join(","),
    DATABASE_URL: `postgresql://postgres:fixture_password@127.0.0.1:${pgPort}/erp_fixture`,
    REDIS_URL: `redis://127.0.0.1:${redisPort}/0`, QUEUE_DRIVER: "redis",
    STORAGE_DRIVER: "local", UPLOAD_DIR: path.join(directory, "uploads"),
    AUTH_PUBLIC_ORIGIN: `http://127.0.0.1:${webPort}`,
    AUTH_DRIVER: "database", AUTH_SECRET: "isolated-runtime-fixture-secret-at-least-32-characters", NEXT_TELEMETRY_DISABLED: "1",
    AMAZON_DATA_CENTER_ENVIRONMENT: "local", AMAZON_SYNC_CENTER_SCOPES: "[]",
    AMAZON_FBA_REMOTE_EXECUTION_ENABLED: "false",
  };
}
