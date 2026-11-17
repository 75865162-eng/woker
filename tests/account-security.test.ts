import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as roster from "@/lib/accounts/team-roster";
import { accountWorkbookColumns, createAccountWorkbookRows, exportAccountWorkbook, parseAccountWorkbookFile } from "@/lib/accounts/account-workbook";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

type RosterRow = roster.TeamAccountRecord & { updatedAt: Date };
type RosterQuery = { where?: { id: { in: string[] } }; omit: { password: boolean } };
type RosterWrite = { create: RosterRow; update: Partial<RosterRow> };
type UserRow = { id: string; email: string; name: string; status: roster.TeamMemberStatus; passwordHash: string; memberships: Array<{ organizationId: string }> };
type UserWrite = { where: { id: string }; update: Partial<UserRow>; create: UserRow };
type Write = { kind: string; data: unknown };
type AccountApi = { GET: (request: Request) => Promise<Response>; PUT: (request: Request) => Promise<Response> };

function loadModule<T>(file: string, dependencies: Record<string, unknown>, database = true): T {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, unknown> = {};
  runInNewContext(compiled, { exports, console, require: (name: string) => {
    assert.ok(name in dependencies, `未声明的依赖：${name}`);
    return dependencies[name];
  }, process: { env: database ? { DATABASE_URL: "隔离依赖，无数据库连接", PROTECTED_SUPER_ACCOUNT_IDS: process.env.PROTECTED_SUPER_ACCOUNT_IDS ?? "" } : {} }, setTimeout });
  return exports as T;
}

const constants = { getBootstrapAdminEmail: () => "bootstrap@fixture.invalid", isBootstrapAdminEmail: (email?: string) => email === "bootstrap@fixture.invalid" };
const account = (id: string, roleId = "operations", password?: string): roster.TeamAccountRecord => ({ id, name: id, email: `${id}@fixture.invalid`, roleId, password, department: "运营", title: "成员", status: "active" });

function fixture(role = "operations_supervisor", database = true) {
  const members: RosterRow[] = [account("editor", role), account("owner", "owner"), account("member")].map(row => ({ ...row, password: "历史明文", updatedAt: new Date(0) }));
  const memberships = members.map(row => ({ organizationId: "org", role: row.roleId, user: { id: row.id, name: row.name, email: row.email, status: row.status } }));
  const users: UserRow[] = members.map(row => ({ id: row.id, email: row.email, name: row.name, status: row.status, passwordHash: hashPassword("原密码"), memberships: [{ organizationId: "org" }] }));
  const writes: Write[] = [];
  const queries: RosterQuery[] = [];
  const client = {
    $queryRaw: async () => [],
    $executeRaw: async () => 1,
    teamRosterMember: {
      findMany: async (query: RosterQuery) => { queries.push(query); return members; },
      deleteMany: async (data: unknown) => { writes.push({ kind: "delete", data }); },
      upsert: async (data: RosterWrite) => { writes.push({ kind: "roster", data }); const index = members.findIndex(row => row.id === data.create.id); if (index >= 0) Object.assign(members[index], data.update); else members.push({ ...data.create, updatedAt: new Date(0) }); },
    },
    organizationMember: {
      upsert: async (data: unknown) => { writes.push({ kind: "syncMembership", data }); const input = data as { where: { organizationId_userId: { organizationId: string; userId: string } } }; return input.where.organizationId_userId; },
      findMany: async () => memberships,
      findUnique: async () => null,
      updateMany: async (data: unknown) => { writes.push({ kind: "membership", data }); },
    },
    user: {
      findUnique: async () => null,
      findMany: async (query: { where?: { id: { in: string[] } } }) => { const ids = query.where?.id.in; return ids ? users.filter(user => ids.includes(user.id)) : users; },
      upsert: async (data: UserWrite) => {
        writes.push({ kind: "user", data });
        const existing = users.find(user => user.id === data.where.id);
        const email = existing ? data.update.email ?? existing.email : data.create.email;
        assert.ok(!users.some(user => user.id !== data.where.id && user.email === email), "登录名不得冲突");
        if (existing) Object.assign(existing, data.update);
        else users.push({ ...data.create, memberships: [] });
      },
    },
    auditLog: { create: async (data: unknown) => { writes.push({ kind: "audit", data }); } },
  };
  const sync = loadModule<typeof import("@/lib/accounts/roster-auth-sync")>("src/lib/accounts/roster-auth-sync.ts", {
    "@/lib/auth/password": { hashPassword }, "@/lib/auth/constants": constants, "@/lib/accounts/team-roster": roster,
    "./member-call-account": { upsertMemberWithCallAccount: async (_client: unknown, data: unknown) => { writes.push({ kind: "syncMembership", data }); } },
  }).syncRosterLoginUsers;
  const prisma = { ...client, $transaction: async (operation: (tx: typeof client) => Promise<unknown>) => operation(client) };
  const snapshot = loadModule<typeof import("@/lib/accounts/team-roster-server")>("src/lib/accounts/team-roster-server.ts", {
    "@/lib/auth/constants": constants, "@/lib/db/prisma": { prisma }, "@/lib/accounts/team-roster": roster,
  }, database);
  const api = loadModule<AccountApi>("src/app/api/accounts/team-members/route.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@prisma/client": { Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } } },
    "@/lib/auth/constants": constants,
    "@/lib/auth/api-permissions": { requireApiPermission: async () => ({ ok: true, user: { id: "editor", role, organizationId: "org" } }) },
    "@/lib/accounts/team-roster": roster, "@/lib/accounts/roster-auth-sync": { syncRosterLoginUsers: sync },
    "@/lib/accounts/team-roster-server": snapshot, "@/lib/db/prisma": { prisma },
  }, database);
  return { members, memberships, users, writes, queries, api, sync: (accounts: Array<roster.TeamAccountRecord & { organizationId: string }>) => sync(client as unknown as Parameters<typeof sync>[0], accounts), put: (accounts: roster.TeamAccountRecord[]) => api.PUT(new Request("http://fixture.invalid/api/accounts/team-members", { method: "PUT", body: JSON.stringify({ accounts }) })) as Promise<Response> };
}

test("账号 GET 不返回历史明文密码且数据库查询排除该列", async () => {
  const state = fixture();
  const response = await state.api.GET(new Request("http://fixture.invalid"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.accounts.length, 3);
  assert.ok(payload.accounts.every((row: object) => !("password" in row)));
  assert.equal(state.queries[0].omit.password, true);
});

test("密码重置只更新 User.passwordHash，普通保存不重置密码，PUT绝不回传密码", async () => {
  const state = fixture();
  const before = state.users.find(user => user.id === "owner")!.passwordHash;
  const response = await state.put([account("member", "operations", "新的测试密码")]);
  assert.equal(response.status, 200, await response.clone().text());
  assert.ok((await response.json()).accounts.every((row: object) => !("password" in row)));
  const member = state.users.find(user => user.id === "member")!;
  assert.equal(verifyPassword("新的测试密码", member.passwordHash), true);
  assert.equal(state.users.find(user => user.id === "owner")!.passwordHash, before);
  for (const write of state.writes.filter(write => write.kind === "roster")) {
    const data = write.data as RosterWrite;
    assert.ok(!("password" in data.create));
    assert.ok(!("password" in data.update));
  }
  assert.ok(state.queries.every(query => query.omit.password));
});

for (const role of ["operations_supervisor", "database_admin", "custom-editor"]) {
  for (const targetRole of ["owner", "database_admin"]) {
    test(`${role} 不能通过新建或修改普通成员提升为 ${targetRole}`, async () => {
      for (const id of ["new-member", "member"]) {
        const state = fixture(role);
        assert.equal((await state.put([account(id, targetRole)])).status, 403);
        assert.equal(state.writes.length, 0);
      }
    });
  }
}

test("非owner的自改和高权账号覆盖被忽略，普通成员资料仍可保存", async () => {
  const state = fixture("custom-editor");
  const response = await state.put([account("editor", "owner", "禁止重置"), account("owner", "operations", "禁止重置"), { ...account("member"), name: "允许更新" }]);
  assert.equal(response.status, 200, await response.clone().text());
  const rows = (await response.json()).accounts;
  assert.equal(rows.find((row: roster.TeamAccountRecord) => row.id === "editor").roleId, "custom-editor");
  assert.equal(rows.find((row: roster.TeamAccountRecord) => row.id === "owner").roleId, "owner");
  assert.equal(rows.find((row: roster.TeamAccountRecord) => row.id === "member").name, "允许更新");
});

test("未入roster的注册owner仍受保护", async () => {
  const state = fixture();
  state.members.splice(state.members.findIndex(row => row.id === "owner"), 1);
  const response = await state.put([account("owner", "operations", "禁止重置")]);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).accounts.find((row: roster.TeamAccountRecord) => row.id === "owner").roleId, "owner");
});

test("保护allowlist不覆盖membership撤权或停用状态", async () => {
  const previous = process.env.PROTECTED_SUPER_ACCOUNT_IDS;
  process.env.PROTECTED_SUPER_ACCOUNT_IDS = "owner";
  try {
    const state = fixture();
    state.memberships.find(row => row.user.id === "owner")!.role = "operations";
    state.memberships.find(row => row.user.id === "owner")!.user.status = "disabled";
    state.members.find(row => row.id === "owner")!.roleId = "owner";
    state.members.find(row => row.id === "owner")!.status = "active";
    const response = await state.api.GET(new Request("http://fixture.invalid"));
    const owner = (await response.json()).accounts.find((row: roster.TeamAccountRecord) => row.id === "owner");
    assert.equal(owner.roleId, "operations");
    assert.equal(owner.status, "disabled");
  } finally {
    if (previous === undefined) delete process.env.PROTECTED_SUPER_ACCOUNT_IDS;
    else process.env.PROTECTED_SUPER_ACCOUNT_IDS = previous;
  }
});

test("已撤销membership的allowlist账号不会因缺失关联而显示为owner", async () => {
  const previous = process.env.PROTECTED_SUPER_ACCOUNT_IDS;
  process.env.PROTECTED_SUPER_ACCOUNT_IDS = "owner";
  try {
    const state = fixture();
    state.memberships.splice(state.memberships.findIndex(row => row.user.id === "owner"), 1);
    const response = await state.api.GET(new Request("http://fixture.invalid"));
    const owner = (await response.json()).accounts.find((row: roster.TeamAccountRecord) => row.id === "owner");
    assert.equal(owner.roleId, "viewer");
    assert.equal(owner.status, "disabled");
  } finally {
    if (previous === undefined) delete process.env.PROTECTED_SUPER_ACCOUNT_IDS;
    else process.env.PROTECTED_SUPER_ACCOUNT_IDS = previous;
  }
});

test("旧roster管理角色不能恢复membership已撤销权限", async () => {
  const state = fixture();
  state.members.find(row => row.id === "editor")!.roleId = "database_admin";
  state.members.find(row => row.id === "owner")!.roleId = "owner";
  state.memberships.find(row => row.user.id === "owner")!.role = "operations";
  const snapshot = await (await state.api.GET(new Request("http://fixture.invalid"))).json();
  assert.equal(snapshot.accounts.find((row: roster.TeamAccountRecord) => row.id === "editor").roleId, "operations_supervisor");
  assert.equal(snapshot.accounts.find((row: roster.TeamAccountRecord) => row.id === "owner").roleId, "operations");
  const response = await state.put([account("member")]);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).accounts.find((row: roster.TeamAccountRecord) => row.id === "editor").roleId, "operations_supervisor");
  for (const write of state.writes.filter(write => write.kind === "membership" || write.kind === "syncMembership")) {
    assert.ok(!JSON.stringify(write.data).includes("database_admin"));
  }
});

test("受保护的共享owner不阻断普通成员编辑且不被修改登录信息", async () => {
  const state = fixture();
  state.users.find(user => user.id === "owner")!.memberships.push({ organizationId: "other-org" });
  const response = await state.put([account("member")]);
  assert.equal(response.status, 200);
  const userWrites = state.writes.filter(write => write.kind === "user").map(write => write.data as UserWrite);
  assert.ok(userWrites.every(write => write.where.id === "member"));
});

test("bootstrap邮箱、local-admin和用户名1不再强制恢复owner与active", async () => {
  for (const id of ["local-admin", "member"]) {
    const state = fixture("owner");
    const candidate = { ...account(id, "viewer"), email: id === "local-admin" ? `local-${id}@fixture.invalid` : "bootstrap@fixture.invalid", username: id === "local-admin" ? id : "1", status: "disabled" as const };
    const response = await state.put([{ ...candidate, password: "显式隔离密码" }]);
    assert.equal(response.status, 200);
    const saved = (await response.json()).accounts.find((row: roster.TeamAccountRecord) => row.id === id);
    assert.equal(saved.roleId, "viewer");
    assert.equal(saved.status, "disabled");
    assert.equal(state.users.find(user => user.id === id)!.status, "disabled");
  }
});

test("PUT保护allowlist保留实时撤权和停用，不恢复旧roster权限", async () => {
  const previous = process.env.PROTECTED_SUPER_ACCOUNT_IDS;
  process.env.PROTECTED_SUPER_ACCOUNT_IDS = " OWNER ";
  try {
    for (const revoked of [false, true]) {
      const state = fixture("owner");
      const membership = state.memberships.find(row => row.user.id === "owner")!;
      membership.role = "operations";
      membership.user.status = "disabled";
      if (revoked) state.memberships.splice(state.memberships.indexOf(membership), 1);
      const response = await state.put([account("owner", "owner", "禁止重置"), account("member")]);
      assert.equal(response.status, 200);
      const saved = (await response.json()).accounts.find((row: roster.TeamAccountRecord) => row.id === "owner");
      assert.equal(saved.roleId, revoked ? "viewer" : "operations");
      assert.equal(saved.status, "disabled");
      assert.ok(state.writes.filter(write => write.kind === "user").every(write => (write.data as UserWrite).where.id !== "owner"));
    }
  } finally {
    if (previous === undefined) delete process.env.PROTECTED_SUPER_ACCOUNT_IDS;
    else process.env.PROTECTED_SUPER_ACCOUNT_IDS = previous;
  }
});

test("owner仍可给普通成员分配管理角色", async () => {
  const state = fixture("owner");
  assert.equal((await state.put([account("member", "database_admin")])).status, 200);
  assert.equal(state.members.find(row => row.id === "member")!.roleId, "database_admin");
});

test("拒绝接管其他租户或跨组织共享用户，写入前失败", async () => {
  for (const memberships of [[{ organizationId: "other-org" }], [{ organizationId: "org" }, { organizationId: "other-org" }], []]) {
    const state = fixture();
    state.users.push({ id: "external", email: "external@fixture.invalid", name: "external", status: "active", passwordHash: hashPassword("不可更改"), memberships });
    assert.equal((await state.put([account("external", "operations", "攻击输入")])).status, 403);
    assert.equal(state.writes.length, 0);
  }
});

test("无数据库模式也不回显密码或允许非owner分配owner", async () => {
  const state = fixture("operations_supervisor", false);
  const response = await state.put([account("new-member", "operations", "一次性输入")]);
  assert.equal(response.status, 200);
  assert.ok(!("password" in (await response.json()).accounts[0]));
  assert.equal((await state.put([account("new-member", "owner")])).status, 403);
});

for (const status of ["disabled", "archived"] as const) {
  test(`显式${status}同步登录状态与资料，真实会话校验拒绝账号`, async () => {
    const state = fixture();
    const response = await state.put([{ ...account("member"), status, name: "修改姓名", phone: "13000000000" }]);
    assert.equal(response.status, 200);
    const user = state.users.find(user => user.id === "member")!;
    assert.equal(user.status, "disabled");
    assert.equal(user.name, "修改姓名");
    assert.equal(user.email, "13000000000");
    const source = readFileSync(new URL("../src/lib/auth/session.ts", import.meta.url), "utf8");
    const parsed = ts.createSourceFile("session.ts", source, ts.ScriptTarget.Latest, true);
    const fn = parsed.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === "getCurrentUserFromPayload");
    assert.ok(fn);
    const compiled = ts.transpileModule(fn.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const check = runInNewContext(`${compiled}; getCurrentUserFromPayload`, {
      getAuthDriver: () => "database", hashToken: () => "fixture",
      measureServerOperation: (_name: string, operation: () => unknown) => operation(),
      prisma: { userSession: { findFirst: async () => ({ user: { ...user, memberships: [{ role: "operations", organizationId: "org", organization: { name: "测试组织" } }] } }) } },
    }) as (payload: object) => Promise<unknown>;
    assert.equal(await check({ driver: "database", expiresAt: "2099-01-01T00:00:00.000Z", userId: user.id, sessionId: "fixture-session", token: "fixture" }), undefined);
    const hash = user.passwordHash;
    await state.sync([{ ...account("member", "owner", "旧roster密码"), organizationId: "org" }]);
    assert.equal(user.status, "disabled");
    assert.equal(user.name, "修改姓名");
    assert.equal(user.email, "13000000000");
    assert.equal(user.passwordHash, hash);
    const membershipWrite = state.writes.filter(write => write.kind === "syncMembership").at(-1)!.data as { update: object };
    assert.equal(Object.keys(membershipWrite.update).length, 0);
  });
}

test("后台增量预留User真实登录名，旧roster候选不能使新成员撞名", async () => {
  const state = fixture();
  const existing = state.users.find(user => user.id === "member")!;
  existing.email = "already-used@fixture.invalid";
  await state.sync([
    { ...account("member"), email: "stale@fixture.invalid", organizationId: "org" },
    { ...account("new-user", "operations", "隔离测试强密码"), email: "already-used@fixture.invalid", organizationId: "org" },
  ]);
  assert.equal(existing.email, "already-used@fixture.invalid");
  assert.equal(state.users.find(user => user.id === "new-user")!.email, "new-user");
});

test("roster登录维护脚本不读取或回写历史明文密码", () => {
  const source = readFileSync(new URL("../scripts/sync-roster-login-users.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /password\s*:\s*true|account\.password/);
});

test("客户端载入丢弃密码，普通保存不发送密码，显式重置才发送", () => {
  const source = readFileSync(new URL("../src/components/accounts/account-workbench-api.ts", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("account-workbench-api.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = ["withLoadedAccountState", "serializeAccountsForApi"];
  const functions = parsed.statements.filter((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text ?? ""));
  assert.equal(functions.length, names.length);
  const compiled = ts.transpileModule(functions.map(statement => statement.getText(parsed)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText.replace(/\bexport\s+/g, "");
  type Input = roster.TeamAccountRecord & { passwordDirty?: boolean };
  const client = runInNewContext(`${compiled}; ({withLoadedAccountState, serializeAccountsForApi})`) as { withLoadedAccountState: (value: Input) => Input; serializeAccountsForApi: (value: Input[]) => Input[] };
  const loaded = client.withLoadedAccountState(account("member", "operations", "历史密码"));
  assert.equal(loaded.password, undefined);
  assert.ok(!("password" in client.serializeAccountsForApi([{ ...account("member", "operations", "不应提交"), passwordDirty: false }])[0]));
  const explicit = client.serializeAccountsForApi([{ ...account("member", "operations", "显式新密码"), passwordDirty: true }])[0];
  assert.equal(explicit.password, "显式新密码");
  assert.ok(!("passwordDirty" in explicit));
});

test("工作簿不导出密码，密码导入仍可作为显式重置输入", async () => {
  const rows = createAccountWorkbookRows([account("member", "operations", "不能导出")], {});
  assert.ok(!accountWorkbookColumns.some(column => String(column) === "password"));
  assert.ok(!("password" in rows[0]));
  const blob = await exportAccountWorkbook([account("member", "operations", "不能导出")], {});
  const XLSX = await import("xlsx");
  const book = XLSX.read(await blob.arrayBuffer(), { type: "array" });
  assert.ok(!JSON.stringify(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]])).includes("不能导出"));
  const imported = await parseAccountWorkbookFile(new File(["id,name,roleId,password\nmember,成员,operations,新的导入密码"], "accounts.csv"), {});
  assert.equal(imported.errors.length, 0);
  assert.equal(imported.accounts[0].password, "新的导入密码");
});
