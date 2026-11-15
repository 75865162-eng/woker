const PREFIX = "tiaotiao.draft.";

export type DraftIdentity = {
  organizationId?: string;
  workspaceId: string;
  userId?: string;
};

export function draftStorageKey(key: string, identity: DraftIdentity) {
  if (!identity.organizationId || !identity.userId) return null;
  return `${PREFIX}${JSON.stringify([identity.organizationId, identity.workspaceId, identity.userId, key])}`;
}

export function readDraft<T>(storage: Pick<Storage, "getItem">, storageKey: string, initial: T): T {
  try {
    const raw = storage.getItem(storageKey);
    const parsed = raw ? (JSON.parse(raw) as { data?: T }) : null;
    return parsed?.data !== undefined ? parsed.data : initial;
  } catch {
    return initial;
  }
}

export function writeDraft<T>(storage: Pick<Storage, "setItem">, storageKey: string | null, data: T) {
  if (!storageKey) return;
  try {
    storage.setItem(storageKey, JSON.stringify({ data, savedAt: Date.now() }));
  } catch {
    // Storage may be unavailable or full.
  }
}

export function removeDraft(storage: Pick<Storage, "removeItem">, storageKey: string | null) {
  if (!storageKey) return;
  try {
    storage.removeItem(storageKey);
  } catch {
    // Storage may be unavailable.
  }
}
