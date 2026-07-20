import type { SaihuHistoryRecord } from "@/lib/saihu-search-merge/types";

const databaseName = "saihu-search-merge-history";
const storeName = "history";
const databaseVersion = 1;

function openHistoryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) {
        const store = database.createObjectStore(storeName, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("历史记录数据库打开失败。"));
  });
}

function transact<T>(mode: IDBTransactionMode, runner: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | void> {
  return openHistoryDatabase().then(
    (database) =>
      new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const request = runner(store);

        transaction.oncomplete = () => {
          database.close();
          resolve(request ? request.result : undefined);
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error ?? new Error("历史记录操作失败。"));
        };
      }),
  );
}

export async function saveSaihuHistoryRecord(record: SaihuHistoryRecord) {
  await transact("readwrite", (store) => store.put(record));
}

export async function listSaihuHistoryRecords() {
  const records = (await transact<SaihuHistoryRecord[]>("readonly", (store) => store.getAll())) ?? [];
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function clearSaihuHistoryRecords() {
  await transact("readwrite", (store) => store.clear());
}

export function createSaihuHistoryId(prefix: string) {
  const randomUUID = globalThis.crypto?.randomUUID?.();
  if (randomUUID) {
    return `${prefix}-${randomUUID}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
