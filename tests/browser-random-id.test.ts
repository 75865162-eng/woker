import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserId } from "@/lib/browser/random-id";

test("browser session ids work without crypto.randomUUID and remain distinct", () => {
  const crypto = globalThis.crypto;
  const descriptor = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
  Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
  try {
    const ids = new Set(Array.from({ length: 100 }, () => createBrowserId()));
    assert.equal(ids.size, 100);
    for (const id of ids) assert.match(id, /^id-[a-z0-9]+-[a-f0-9]{32}$/);
  } finally {
    if (descriptor) Object.defineProperty(crypto, "randomUUID", descriptor);
    else Reflect.deleteProperty(crypto, "randomUUID");
  }
});
