import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type Loader = (env: Record<string, string>) => {
  resolveSessionMaxAgeSeconds: (role?: string | null) => number;
};

function loadSessionLifetime(): Loader {
  const source = readFileSync(new URL("../src/lib/auth/session.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return (env) => {
    const exports: Record<string, unknown> = {};
    const sandbox = {
      exports,
      // session.ts 顶层有静态 import，这里只需让模块求值通过；
      // 被测的 resolveSessionMaxAgeSeconds 不调用任何依赖。
      require: (name: string) => {
        if (name === "react") return { cache: (fn: unknown) => fn };
        if (name === "@/lib/auth/constants") return { sessionMaxAgeSeconds: 12 * 60 * 60 };
        return {};
      },
      process: { env },
      console,
      setTimeout,
      Buffer,
    };
    runInNewContext(compiled, sandbox);
    return exports as ReturnType<Loader>;
  };
}

const DAY = 24 * 60 * 60;
const load = loadSessionLifetime();

test("超级管理员默认会话为 5 天，普通角色沿用 12 小时", () => {
  const { resolveSessionMaxAgeSeconds } = load({});
  assert.equal(resolveSessionMaxAgeSeconds("owner"), 5 * DAY);
  assert.equal(resolveSessionMaxAgeSeconds("database_admin"), 5 * DAY);
  assert.equal(resolveSessionMaxAgeSeconds("viewer"), 12 * 60 * 60);
  assert.equal(resolveSessionMaxAgeSeconds(undefined), 12 * 60 * 60);
});

test("超管会话可用环境变量延长，但不低于 5 天", () => {
  const longer = load({ AUTH_PRIVILEGED_SESSION_MAX_AGE_SECONDS: String(10 * DAY) });
  assert.equal(longer.resolveSessionMaxAgeSeconds("owner"), 10 * DAY);

  const shorter = load({ AUTH_PRIVILEGED_SESSION_MAX_AGE_SECONDS: String(60 * 60) });
  assert.equal(shorter.resolveSessionMaxAgeSeconds("owner"), 5 * DAY, "低于 5 天的配置必须被夹到下限");
});

test("普通用户会话可用环境变量覆盖，超管配置不影响普通用户", () => {
  const mod = load({
    AUTH_SESSION_MAX_AGE_SECONDS: String(2 * DAY),
    AUTH_PRIVILEGED_SESSION_MAX_AGE_SECONDS: String(7 * DAY),
  });
  assert.equal(mod.resolveSessionMaxAgeSeconds("viewer"), 2 * DAY);
  assert.equal(mod.resolveSessionMaxAgeSeconds("owner"), 7 * DAY);
});

test("非法/为空的环境变量被忽略，回落到安全默认值", () => {
  const bad = load({ AUTH_PRIVILEGED_SESSION_MAX_AGE_SECONDS: "abc", AUTH_SESSION_MAX_AGE_SECONDS: "0" });
  assert.equal(bad.resolveSessionMaxAgeSeconds("owner"), 5 * DAY);
  assert.equal(bad.resolveSessionMaxAgeSeconds("viewer"), 12 * 60 * 60);
});
