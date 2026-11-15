import assert from "node:assert/strict";
import test from "node:test";
import { draftStorageKey, readDraft, removeDraft, writeDraft } from "../src/lib/workspace/draft-storage";

function createStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

const identity = { organizationId: "org-a", workspaceId: "workspace-a", userId: "user-a" };

test("draft keys isolate workspace, organization, user, and form key", () => {
  const key = draftStorageKey("form", identity);
  assert.ok(key);
  for (const changed of [
    { ...identity, workspaceId: "workspace-b" },
    { ...identity, organizationId: "org-b" },
    { ...identity, userId: "user-b" },
  ]) assert.notEqual(draftStorageKey("form", changed), key);
  assert.notEqual(draftStorageKey("other-form", identity), key);
  assert.equal(draftStorageKey("form", { ...identity, organizationId: undefined }), null);
  assert.equal(draftStorageKey("form", { ...identity, userId: undefined }), null);
});

test("a draft write and clear stay bound to the identity captured at invocation", () => {
  const storage = createStorage();
  const keyA = draftStorageKey("form", identity)!;
  const keyB = draftStorageKey("form", { ...identity, workspaceId: "workspace-b" })!;
  const capturedUpdateKey = keyA;
  const capturedClearKey = keyA;

  writeDraft(storage, capturedUpdateKey, "from A");
  writeDraft(storage, keyB, "from B");
  removeDraft(storage, capturedClearKey);

  assert.equal(readDraft(storage, keyA, "initial"), "initial");
  assert.equal(readDraft(storage, keyB, "initial"), "from B");
});

test("unauthenticated drafts are not persisted", () => {
  const storage = createStorage();
  const key = draftStorageKey("form", { workspaceId: "workspace-a" });
  writeDraft(storage, key, "private input");
  removeDraft(storage, key);
  assert.equal(storage.values.size, 0);
});

test("invalid or unavailable stored data falls back to the initial value", () => {
  const storage = createStorage();
  const key = draftStorageKey("form", identity)!;
  storage.values.set(key, "not-json");
  assert.equal(readDraft(storage, key, "initial"), "initial");
  assert.equal(readDraft({ getItem: () => { throw new Error("unavailable"); } }, key, "initial"), "initial");
});
