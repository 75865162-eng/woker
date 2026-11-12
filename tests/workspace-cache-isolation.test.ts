import assert from "node:assert/strict";
import test from "node:test";
import { fetchWorkspacesCached, invalidateWorkspaceApiCache, setWorkspaceApiCacheScope } from "@/lib/workspace/workspace-api-cache";

test("workspace cache deduplicates, isolates identity/revision, and rejects late cache publication", async () => {
  const original = globalThis.fetch;
  let reads = 0;
  let finishOld: ((value: Response) => void) | undefined;
  globalThis.fetch = async () => {
    reads++;
    if (reads === 2) return new Promise<Response>(resolve => { finishOld = resolve; });
    return Response.json({ workspaces: [{ id: `scope-${reads}` }] });
  };
  try {
    setWorkspaceApiCacheScope("org-a:user-a:viewer:1");
    const first = await Promise.all([fetchWorkspacesCached(), fetchWorkspacesCached()]);
    assert.equal(reads, 1); assert.strictEqual(first[0], first[1]);
    invalidateWorkspaceApiCache();
    const old = fetchWorkspacesCached();
    setWorkspaceApiCacheScope("org-b:user-b:viewer:1");
    assert.equal((await fetchWorkspacesCached()).workspaces[0].id, "scope-3");
    finishOld!(Response.json({ workspaces: [{ id: "must-not-publish" }] })); await old;
    assert.equal((await fetchWorkspacesCached()).workspaces[0].id, "scope-3");
    assert.equal(reads, 3);
    setWorkspaceApiCacheScope("org-b:user-b:viewer:2");
    await fetchWorkspacesCached(); assert.equal(reads, 4);
  } finally { globalThis.fetch = original; invalidateWorkspaceApiCache(); }
});
