export function createBrowserId() {
  const randomUUID = globalThis.crypto?.randomUUID;

  if (typeof randomUUID === "function") {
    return randomUUID.call(globalThis.crypto);
  }

  const values = new Uint32Array(4);
  globalThis.crypto?.getRandomValues?.(values);
  const entropy = Array.from(values, (value) => value.toString(16).padStart(8, "0")).join("");

  return `id-${Date.now().toString(36)}-${entropy || Math.random().toString(36).slice(2)}`;
}
