import { AsyncLocalStorage } from "node:async_hooks";
import { resolveSellfoxCredentials, type SellfoxResolvedCredentials } from "./credential-store";
import type { Prisma } from "@prisma/client";
import type { SellfoxCredentialScope } from "./credential-crypto";

const context = new AsyncLocalStorage<() => Promise<SellfoxResolvedCredentials>>();
export function withSellfoxCredentialScope<T>(scope: SellfoxCredentialScope, work: () => Promise<T>, db?: Prisma.TransactionClient & { workspaceMembership?: Prisma.TransactionClient["workspaceMembership"] }) {
  let resolved: Promise<SellfoxResolvedCredentials> | undefined;
  const getCredentials = () => resolved ??= resolveSellfoxCredentials(scope, db);
  return context.run(getCredentials, work);
}
export function currentSellfoxCredentials() { return context.getStore()?.(); }
