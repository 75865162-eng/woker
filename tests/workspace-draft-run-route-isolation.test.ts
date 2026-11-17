import assert from "node:assert/strict";
import test from "node:test";
import { draftRunSaveErrorResponse, DraftRunIdConflictError, saveDraftRun } from "@/app/api/workspace/draft-runs/save-draft-run";

type Row = Record<string, unknown>;
const rows = new Map<string, Row>();
function key(where: Row) { return String(where.id); }

const userA = { id: "user-a", organizationId: "org-a" };
const scopeA = { workspaceId: "workspace-a", accountId: "", marketplace: "" };
function createFixtureDb() {
  const draftRun = {
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const row = rows.get(key(where));
      if (!row || Object.entries(where).some(([field, value]) => row[field] !== value)) return { count: 0 };
      rows.set(key(where), { ...row, ...data });
      return { count: 1 };
    },
    findFirstOrThrow: async ({ where }: { where: Row }) => {
      const row = rows.get(key(where));
      if (!row || Object.entries(where).some(([field, value]) => row[field] !== value)) throw new Error("not found");
      return row;
    },
    create: async ({ data }: { data: Row }) => {
      if (rows.has(key(data))) throw Object.assign(new Error("unique constraint: private target data"), { code: "P2002", meta: { target: "DraftRun_pkey" } });
      rows.set(key(data), data);
      return data;
    },
  };
  return { $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({ draftRun }) } as never;
}

test("draft run writes stay bound to organization, workspace, and owner", async (t) => {
  const initialRows = new Map(rows);
  rows.clear();
  rows.set("owned", { id: "owned", organizationId: "org-a", workspaceId: "workspace-a", userId: "user-a", accountId: "", marketplace: "", drafts: ["old"] });
  rows.set("other-workspace", { id: "other-workspace", organizationId: "org-a", workspaceId: "workspace-b", userId: "user-a", accountId: "", marketplace: "", drafts: ["private"] });
  rows.set("other-user", { id: "other-user", organizationId: "org-a", workspaceId: "workspace-a", userId: "user-b", accountId: "", marketplace: "", drafts: ["private"] });
  rows.set("other-org", { id: "other-org", organizationId: "org-b", workspaceId: "workspace-a", userId: "user-b", accountId: "", marketplace: "", drafts: ["private"] });
  rows.set("other-account", { id: "other-account", organizationId: "org-a", workspaceId: "workspace-a", userId: "user-a", accountId: "account-b", marketplace: "US", drafts: ["private"] });
  rows.set("other-site", { id: "other-site", organizationId: "org-a", workspaceId: "workspace-a", userId: "user-a", accountId: "account-a", marketplace: "CA", drafts: ["private"] });

  const db = createFixtureDb();

  t.after(() => {
    rows.clear();
    for (const [id, row] of initialRows) rows.set(id, row);
  });

  for (const id of ["other-org", "other-workspace", "other-user", "other-account", "other-site"]) {
    const before = structuredClone(rows.get(id));
    await assert.rejects(saveDraftRun({ db, id, user: userA, scope: scopeA, body: { drafts: ["attack"] }, createdAt: undefined }));
    assert.deepEqual(rows.get(id), before);
  }

  const updated = await saveDraftRun({ db, id: "owned", user: userA, scope: scopeA, body: { drafts: ["new"] }, createdAt: undefined });
  assert.deepEqual((updated as Row).drafts, ["new"]);
  const updatedAgain = await saveDraftRun({ db, id: "owned", user: userA, scope: scopeA, body: { drafts: ["newer"] }, createdAt: undefined });
  assert.deepEqual((updatedAgain as Row).drafts, ["newer"]);

  const created = await saveDraftRun({ db, id: "new-run", user: userA, scope: scopeA, body: { drafts: ["created"] }, createdAt: undefined });
  assert.deepEqual((created as Row).drafts, ["created"]);
  assert.equal(rows.get("new-run")?.organizationId, "org-a");
  assert.equal(rows.get("new-run")?.workspaceId, "workspace-a");
  assert.equal(rows.get("new-run")?.userId, "user-a");

  await assert.rejects(
    saveDraftRun({ db, id: "other-org", user: userA, scope: scopeA, body: { drafts: ["attack"] }, createdAt: undefined }),
    DraftRunIdConflictError,
  );
  assert.deepEqual(rows.get("other-org")?.drafts, ["private"]);
  await assert.rejects(
    saveDraftRun({ db, id: "other-org", user: userA, scope: scopeA, body: { drafts: ["attack"] }, createdAt: undefined }),
    error => error instanceof DraftRunIdConflictError && !error.message.includes("private target data"),
  );
  const conflictResponse = draftRunSaveErrorResponse(new DraftRunIdConflictError())!;
  assert.equal(conflictResponse.status, 409);
  assert.doesNotMatch(await conflictResponse.text(), /P2002|DraftRun_pkey|private target data/);
});
