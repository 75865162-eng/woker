import type { WorkspaceSnapshotRecord } from "@/lib/types";

const workspaceDbName = "amazon-ppc-workspace";
const workspaceStoreName = "snapshots";
const workspaceSnapshotKey = "current";

function openWorkspaceDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(workspaceDbName, 1);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(workspaceStoreName)) {
        db.createObjectStore(workspaceStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("打开本地 Repository 失败。"));
  });
}

export async function readWorkspaceSnapshot<T>(): Promise<WorkspaceSnapshotRecord & { snapshot: T } | undefined> {
  if (typeof indexedDB === "undefined") {
    return undefined;
  }

  const db = await openWorkspaceDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(workspaceStoreName, "readonly");
    const request = transaction.objectStore(workspaceStoreName).get(workspaceSnapshotKey);

    request.onsuccess = () => resolve(request.result as (WorkspaceSnapshotRecord & { snapshot: T }) | undefined);
    request.onerror = () => reject(request.error ?? new Error("读取本地 Workspace Snapshot 失败。"));
    transaction.oncomplete = () => db.close();
  });
}

export async function writeWorkspaceSnapshot<T>(snapshot: T) {
  if (typeof indexedDB === "undefined") {
    return;
  }

  const db = await openWorkspaceDb();
  const payload: WorkspaceSnapshotRecord & { snapshot: T } = {
    version: 1,
    savedAt: new Date().toISOString(),
    snapshot,
  };

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(workspaceStoreName, "readwrite");
    const request = transaction.objectStore(workspaceStoreName).put(payload, workspaceSnapshotKey);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("保存 Workspace Snapshot 失败。"));
    transaction.oncomplete = () => db.close();
  });
}

export async function deleteWorkspaceSnapshot() {
  if (typeof indexedDB === "undefined") {
    return;
  }

  const db = await openWorkspaceDb();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(workspaceStoreName, "readwrite");
    const request = transaction.objectStore(workspaceStoreName).delete(workspaceSnapshotKey);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("删除 Workspace Snapshot 失败。"));
    transaction.oncomplete = () => db.close();
  });
}
