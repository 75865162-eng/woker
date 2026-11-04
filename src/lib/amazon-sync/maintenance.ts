/** Retention policy is configuration only. Destructive cleanup needs its own reviewed
 * execution grant and is deliberately unavailable until that executor is implemented. */
export async function maintainSyncCenter(...args: unknown[]) { void args; return { cleaned: 0, approvalRequired: true }; }
