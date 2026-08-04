import type { WorkspaceSnapshotRecord } from "@/lib/types";

const workspaceDbName = "amazon-ppc-workspace";
const workspaceStoreName = "snapshots";
const workspaceSnapshotKey = "current";
const arrayBufferMarker = "__workspaceArrayBufferBase64";

type WorkspaceSnapshotApiRecord<T> = WorkspaceSnapshotRecord & { snapshot: T };

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }

  return window.btoa(binary);
}

function base64ToArrayBuffer(value: string) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

function encodeSnapshotForJson<T>(snapshot: T): T {
  if (!snapshot || typeof snapshot !== "object") {
    return snapshot;
  }

  const record = { ...(snapshot as Record<string, unknown>) };

  if (record.originalWorkbookBuffer instanceof ArrayBuffer) {
    record.originalWorkbookBuffer = {
      [arrayBufferMarker]: arrayBufferToBase64(record.originalWorkbookBuffer),
    };
  }

  return record as T;
}

function decodeSnapshotFromJson<T>(snapshot: T): T {
  if (!snapshot || typeof snapshot !== "object") {
    return snapshot;
  }

  const record = { ...(snapshot as Record<string, unknown>) };
  const encodedBuffer = record.originalWorkbookBuffer;

  if (
    encodedBuffer &&
    typeof encodedBuffer === "object" &&
    !Array.isArray(encodedBuffer) &&
    typeof (encodedBuffer as Record<string, unknown>)[arrayBufferMarker] === "string"
  ) {
    record.originalWorkbookBuffer = base64ToArrayBuffer(
      (encodedBuffer as Record<string, string>)[arrayBufferMarker],
    );
  }

  return record as T;
}

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
  const remote = await readRemoteWorkspaceSnapshot<T>();

  if (remote?.snapshot) {
    await writeIndexedDbWorkspaceSnapshot(remote.snapshot);
    return remote;
  }

  const local = await readIndexedDbWorkspaceSnapshot<T>();

  if (local?.snapshot) {
    await writeRemoteWorkspaceSnapshot(local.snapshot).catch(() => undefined);
  }

  return local;
}

export async function writeWorkspaceSnapshot<T>(snapshot: T) {
  await writeIndexedDbWorkspaceSnapshot(snapshot);
  await writeRemoteWorkspaceSnapshot(snapshot);
}

export async function deleteWorkspaceSnapshot() {
  await deleteIndexedDbWorkspaceSnapshot();
  await deleteRemoteWorkspaceSnapshot();
}

async function readRemoteWorkspaceSnapshot<T>(): Promise<WorkspaceSnapshotApiRecord<T> | undefined> {
  try {
    const response = await fetch("/api/workspace/snapshot");

    if (response.status === 401 || response.status === 404) {
      return undefined;
    }

    if (!response.ok) {
      throw new Error("读取数据库 Workspace Snapshot 失败。");
    }

    const data = (await response.json()) as {
      version?: number;
      savedAt?: string;
      snapshot?: T | null;
    };

    if (!data.snapshot) {
      return undefined;
    }

    return {
      version: data.version ?? 1,
      savedAt: data.savedAt ?? new Date().toISOString(),
      snapshot: decodeSnapshotFromJson(data.snapshot),
    };
  } catch {
    return undefined;
  }
}

async function writeRemoteWorkspaceSnapshot<T>(snapshot: T) {
  const response = await fetch("/api/workspace/snapshot", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      version: 1,
      snapshot: encodeSnapshotForJson(snapshot),
    }),
  });

  if (response.status === 401) {
    return;
  }

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "保存数据库 Workspace Snapshot 失败。");
  }
}

async function deleteRemoteWorkspaceSnapshot() {
  const response = await fetch("/api/workspace/snapshot", {
    method: "DELETE",
  });

  if (response.status === 401) {
    return;
  }

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "删除数据库 Workspace Snapshot 失败。");
  }
}

async function readIndexedDbWorkspaceSnapshot<T>(): Promise<WorkspaceSnapshotRecord & { snapshot: T } | undefined> {
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

async function writeIndexedDbWorkspaceSnapshot<T>(snapshot: T) {
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

async function deleteIndexedDbWorkspaceSnapshot() {
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
