// Disposable Next app: real Lili routes/middleware, mocked ERP identity; no dotenv, DB or provider requests.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("native Next routes render, preserve old URLs and enforce ERP module permissions without 43123", { timeout: 120_000 }, async () => {
  const root = process.cwd();
  const temporary = await mkdtemp(join(tmpdir(), "lili-native-fixture-"));
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const origin = `http://127.0.0.1:${port}`;
  const fixtureSecret = "lili-disposable-fixture-secret-without-real-credentials";
  let output = "";
  let server: ReturnType<typeof spawn> | undefined;
  const cookiePayload = Buffer.from(JSON.stringify({ driver: "local", expiresAt: new Date(Date.now() + 300_000).toISOString() })).toString("base64url");
  const signed = `${cookiePayload}.${createHmac("sha256", fixtureSecret).update(cookiePayload).digest("base64url")}`;
  async function get(path: string, role = "owner") {
    return fetch(`${origin}${path}`, { redirect: "manual", headers: role === "anonymous" ? {} : { cookie: `amazon_bulk_ad_session=${signed}; fixture_role=${role}` }, signal: AbortSignal.timeout(45_000) });
  }
  try {
    await symlink(join(root, "node_modules"), join(temporary, "node_modules"), "dir");
    const copies = ["src/app/lili", "src/app/api/lili", "src/components/lili", "src/lib/lili", "src/data/lili", "src/lib/integrations/sellersprite.ts", "src/lib/workspace/scope.ts", "src/lib/accounts/permissions.ts", "src/lib/accounts/role-definitions.ts", "src/lib/auth/constants.ts", "middleware.ts"];
    for (const path of copies) {
      const destination = join(temporary, path);
      await mkdir(join(destination, ".."), { recursive: true });
      await cp(join(root, path), destination, { recursive: true });
    }
    await mkdir(join(temporary, "src/components/app-shell"), { recursive: true });
    await writeFile(join(temporary, "src/lib/lili/tool-config-server.ts"), `import { defaultXiyouSettings, mergeXiyouSettings } from "./tool-config";
      export type ToolConfigStore = {read(scope:unknown):Promise<typeof defaultXiyouSettings>;save(scope:unknown,patch:unknown):Promise<typeof defaultXiyouSettings>};
      export const toolConfigStore:ToolConfigStore={async read(){return {...defaultXiyouSettings};},async save(_scope,patch){return mergeXiyouSettings(patch);}};`);
    await writeFile(join(temporary, "src/components/app-shell/app-shell.tsx"), 'export function AppShell({children}:{children:React.ReactNode}) {return <main data-fixture-shell="true">{children}</main>;}');
    await writeFile(join(temporary, "src/lib/accounts/role-permissions-server.ts"), 'import {defaultRolePermissionMap} from "./permissions"; export async function getOrganizationRolePermissions(_organizationId:string) {return {...defaultRolePermissionMap, limited:{agents:["view" as const]}};}');
    await writeFile(join(temporary, "src/lib/auth/api-permissions.ts"), `import {cookies} from "next/headers";
      import {NextResponse} from "next/server";
      import {roleCanPerformAction, type PermissionAction} from "@/lib/accounts/permissions";
      import {getOrganizationRolePermissions} from "@/lib/accounts/role-permissions-server";
      export async function requireApiPermission(moduleId:string,action:PermissionAction,request?:Request) {
        const role = request ? request.headers.get("cookie")?.match(/fixture_role=([^;]+)/)?.[1] : (await cookies()).get("fixture_role")?.value;
        if (!role) return {ok:false as const,response:NextResponse.json({error:"Unauthorized"},{status:401})};
        if (!roleCanPerformAction(role,moduleId,action,await getOrganizationRolePermissions("fixture-org"))) return {ok:false as const,response:NextResponse.json({error:"Forbidden"},{status:403})};
        return {ok:true as const,user:{id:"fixture-user",organizationId:"fixture-org",role,name:"Fixture",email:"fixture@lili.invalid",organizationName:"Fixture"}};
      }`);
    await writeFile(join(temporary, "src/app/layout.tsx"), 'export default function Layout({children}:{children:React.ReactNode}) {return <html lang="zh-CN"><body>{children}</body></html>;}');
    await writeFile(join(temporary, "package.json"), JSON.stringify({ name: "lili-isolated-route-fixture", private: true }));
    await writeFile(join(temporary, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2017", lib: ["dom", "esnext"], strict: true, skipLibCheck: true, esModuleInterop: true, module: "esnext", moduleResolution: "bundler", resolveJsonModule: true, jsx: "preserve", baseUrl: ".", paths: { "@/*": ["./src/*"] } }, include: ["src/**/*.ts", "src/**/*.tsx", "middleware.ts"] }));
    await writeFile(join(temporary, "next.config.mjs"), 'export default {devIndicators:false};');
    server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: temporary, stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: temporary, NODE_ENV: "development", AUTH_DRIVER: "local", AUTH_SECRET: fixtureSecret, NEXT_TELEMETRY_DISABLED: "1" },
    });
    server.stdout?.on("data", (chunk) => { output = (output + chunk.toString()).slice(-12_000); });
    server.stderr?.on("data", (chunk) => { output = (output + chunk.toString()).slice(-12_000); });
    const deadline = Date.now() + 30_000;
    while (!output.includes("Ready in")) {
      if (server.exitCode !== null) throw new Error(`Fixture server exited: ${output}`);
      if (Date.now() > deadline) throw new Error(`Fixture server did not become ready: ${output}`);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const anonymous = await get("/lili", "anonymous");
    assert.equal(anonymous.status, 307); assert.match(anonymous.headers.get("location")!, /\/login\?next=/);
    assert.equal((await get("/lili/api/health", "anonymous")).status, 401);
    assert.equal((await get("/api/lili/health", "anonymous")).status, 401);
    const pages = ["/lili", "/lili/v2/skills", "/lili/v2/skills/acos-reduction-plan", "/lili/v2/lab/skills/acos-reduction-plan", "/lili/v2/cases", "/lili/v2/cases/competitor-teardown", "/lili/v2/lab/cases/monday-review", "/lili/v2/workflows", "/lili/v2/workflows/monday-review", "/lili/v2/tools", "/lili/v2/tools/meta_search_skills", "/lili/v2/approvals", "/lili/v2/recharge", "/lili/v2/help", "/lili/v2/tool-config"];
    for (const path of pages) {
      const response = await get(path);
      assert.equal(response.status, 200, `${path}: ${output}`);
      assert.match(await response.text(), /data-fixture-shell/);
    }
    const limitedConfig = await get("/lili/v2/tool-config", "limited");
    assert.equal(limitedConfig.status, 307); assert.match(limitedConfig.headers.get("location")!, /forbidden/);
    for (const path of ["/api/lili/tool-config", "/lili/api/tool-config"]) {
      const response = await get(path);
      assert.equal(response.status, 200); assert.equal((await response.json()).settings.hasMcpToken, false);
      assert.equal((await get(path, "limited")).status, 403);
    }
    for (const [path, destination] of [["/lili/v2/settings", "/settings"], ["/lili/v2/team", "/accounts"]]) {
      const response = await get(path);
      assert.equal(response.status, 307); assert.equal(response.headers.get("location"), destination);
      const limited = await get(path, "limited");
      assert.equal(limited.status, 307); assert.match(limited.headers.get("location")!, /forbidden/);
    }
    for (const path of ["/api/lili/health", "/lili/api/health"]) {
      const response = await get(path);
      assert.equal(response.status, 200); assert.equal((await response.json()).tools, 107);
    }
    for (const path of ["/lili/v2/skills/not-in-catalog", "/lili/v2/courses", "/lili/v2/courses/codex-listings", "/lili/v2/courses/setup-qa"]) {
      assert.equal((await get(path)).status, 404, path);
    }
    console.log("Native fixture verified 15 rendered routes including restored tool configuration, removed course routes, 2 integrated destinations, both configuration API namespaces and auth denials.");
  } finally {
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { server?.kill("SIGKILL"); resolve(); }, 3000);
        server!.once("exit", () => { clearTimeout(timer); resolve(); });
      });
    }
    await rm(temporary, { recursive: true, force: true });
  }
});
