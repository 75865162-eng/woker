export type ProductDraftIdentity = {
  organizationId: string;
  workspaceId: string;
  userId: string;
  entityId: string;
  editorType: "product";
};

export type LocalProductDraft<T> = {
  key: string;
  identityKey: string;
  identity: ProductDraftIdentity;
  schemaVersion: 1;
  baseRevision?: number;
  original: T;
  form: T;
  updatedAt: string;
};

export function productDraftIdentityKey(identity: ProductDraftIdentity) {
  if (Object.values(identity).some((value) => !value.trim())) {
    throw new Error("无法确认账号或工作区，本地草稿暂存不可用。");
  }
  return JSON.stringify([identity.organizationId, identity.workspaceId, identity.userId, identity.entityId, identity.editorType]);
}

const databaseName = "amazon-product-edit-drafts";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("浏览器不支持 IndexedDB，无法暂存草稿。"));
      return;
    }
    const request = indexedDB.open(databaseName, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("drafts", { keyPath: "key" });
      store.createIndex("identityKey", "identityKey");
    };
    request.onerror = () => reject(request.error ?? new Error("草稿数据库打开失败。"));
    request.onblocked = () => { blocked = true; reject(new Error("草稿数据库被其他页面阻塞，请关闭旧页面后重试。")); };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else { request.result.onversionchange = () => request.result.close(); resolve(request.result); }
    };
  });
}

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("drafts", mode);
      const request = run(tx.objectStore("drafts"));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error ?? request.error ?? new Error("草稿读写失败。"));
      tx.onabort = () => reject(tx.error ?? new Error("草稿读写已中止。"));
    });
  } finally {
    db.close();
  }
}

export async function readProductDrafts<T>(identity: ProductDraftIdentity): Promise<LocalProductDraft<T>[]> {
  const identityKey = productDraftIdentityKey(identity);
  const records = await transaction<LocalProductDraft<T>[]>("readonly", (store) => store.index("identityKey").getAll(identityKey));
  if (records.some((record) => record.schemaVersion !== 1 || record.identityKey !== identityKey
    || productDraftIdentityKey(record.identity) !== identityKey
    || !record.key.startsWith(`${identityKey}:`) || !record.original || !record.form
    || typeof record.updatedAt !== "string" || !Number.isFinite(Date.parse(record.updatedAt)))) {
    throw new Error("存在不兼容或损坏的草稿，已保留原记录，未自动恢复。请联系管理员。");
  }
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function writeProductDraft<T>(record: LocalProductDraft<T>) {
  if (record.identityKey !== productDraftIdentityKey(record.identity)) throw new Error("草稿身份不匹配。");
  await transaction("readwrite", (store) => store.put(record));
}

// Delete only the snapshot the editor observed; another tab's newer draft is not ours to discard.
export async function deleteProductDraft(key: string, updatedAt?: string) {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      const store = tx.objectStore("drafts");
      const request = store.get(key);
      request.onsuccess = () => {
        if (!request.result || !updatedAt || request.result.updatedAt === updatedAt) store.delete(key);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("草稿清理失败。"));
    });
  } finally {
    db.close();
  }
}

/** Explicit recovery only. Whole edited arrays/objects replace their latest counterparts; never auto-submit. */
export function restoreProductEdits<T extends object>(original: T, form: T, latest: T): T {
  const result = { ...latest };
  for (const key of Object.keys(form) as (keyof T)[]) {
    if (key !== "revision" && JSON.stringify(form[key]) !== JSON.stringify(original[key])) result[key] = form[key];
  }
  return result;
}
