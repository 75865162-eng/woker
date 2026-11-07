import { AsyncLocalStorage } from "node:async_hooks";
import { resolveSellfoxCredentials, type SellfoxResolvedCredentials } from "./credential-store";
import type { SellfoxCredentialScope } from "./credential-crypto";

const context = new AsyncLocalStorage<() => Promise<SellfoxResolvedCredentials>>();
export function withSellfoxCredentials<T>(credentials: SellfoxResolvedCredentials, work: () => Promise<T>) { return context.run(() => Promise.resolve(Object.freeze({ ...credentials })), work); }
export function withSellfoxCredentialScope<T>(scope: SellfoxCredentialScope, work: () => Promise<T>) {
  let resolved: Promise<SellfoxResolvedCredentials> | undefined;
  return context.run(() => resolved ??= resolveSellfoxCredentials(scope), work);
}
export function currentSellfoxCredentials() { return context.getStore()?.(); }
