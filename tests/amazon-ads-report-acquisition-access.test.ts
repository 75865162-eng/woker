import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Compile just the production function; dependency fixtures never open a database or network connection.
const source = readFileSync(fileURLToPath(new URL("../src/lib/amazon-ads/report-service.ts", import.meta.url)), "utf8");
const parsed = ts.createSourceFile("report-service.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const implementation = parsed.statements.find(
  (statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === "reportAcquisitionOverview",
);
assert.ok(implementation, "reportAcquisitionOverview must exist");
const compiled = ts.transpileModule(implementation.getText(parsed).replace(/^export /, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

type Profile = { id: string; sellerAccountId: string; organizationId: string; workspaceId: string; authorization: { status: string } };
type Where = Record<string, unknown> & { AND?: Where[]; OR?: Where[] };
function matches(record: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "AND") return (expected as Where[]).every(clause => matches(record, clause));
    if (key === "OR") return (expected as Where[]).some(clause => matches(record, clause));
    const actual = record[key];
    if (expected && typeof expected === "object") {
      if ("in" in expected) return (expected.in as unknown[]).includes(actual);
      return actual !== null && typeof actual === "object" && matches(actual as Record<string, unknown>, expected as Where);
    }
    return actual === expected;
  });
}

test("报表采集概览只返回用户获授权且有效的 Seller Profile", async () => {
  const scope = { organizationId: "org", workspaceId: "workspace" };
  const profiles: Profile[] = [
    { ...scope, id: "assigned", sellerAccountId: "seller-a", authorization: { status: "CONNECTED" } },
    { ...scope, id: "unassigned", sellerAccountId: "seller-b", authorization: { status: "CONNECTED" } },
    { ...scope, id: "other-workspace", sellerAccountId: "seller-a", workspaceId: "other", authorization: { status: "CONNECTED" } },
  ];
  const activeSellers = [{ id: "seller-a" }, { id: "seller-b" }];
  const access = { allSellers: false, sellerIds: ["seller-a"] };
  const queries: Where[] = [];
  const context = {
    amazonDataAccess: async () => access,
    sellerAccessWhere: (grant: typeof access) => ({ sellerAccountId: { in: grant.sellerIds } }),
    prisma: {
      sellerAccount: { findMany: async () => activeSellers },
      amazonAdsProfile: { findMany: async ({ where }: { where: Where }) => { queries.push(where); return profiles.filter(profile => matches(profile, where)); } },
      amazonAdsSyncPlan: { findFirst: async () => null },
    },
    spReportStatus: async () => [],
    spReportPipelineEnabled: () => false,
    spReportTypeIds: [],
    process: { env: {} },
  };
  const overview = runInNewContext(`${compiled}; reportAcquisitionOverview`, context) as (inputScope: typeof scope, actor: string, profileRecordId?: string) => Promise<{ profiles: Array<{ profile: Profile }> }>;
  const list = await overview(scope, "assigned-user");
  assert.equal(list.profiles.map(row => row.profile.id).join(","), "assigned");
  assert.equal(queries[0].AND?.length, 2, "授权过滤与有效账号过滤必须同时生效");
  const requestedOther = await overview(scope, "assigned-user", "unassigned");
  assert.equal(requestedOther.profiles.length, 0, "显式请求未分配账号也不得返回");
  access.sellerIds = [];
  const noGrants = await overview(scope, "assigned-user");
  assert.equal(noGrants.profiles.length, 0, "空账号授权必须拒绝所有 Profile");
});
