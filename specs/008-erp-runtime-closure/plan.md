# Implementation plan

Reuse ImportJob/ImageUpscaleJob and existing processors, queue scans and StorageDriver. Add nullable execution token/expiry, attempt count/default limit and status/expiry indexes. No business data migration or bulk running reset. Use database clock plus per-row locks for publication; unique per-attempt output keys. Route audit writes into the same transaction where used by a fenced processor. Expired owned executions become queued or terminal failed in bounded scans; legacy running rows with no token remain manual-review only.

Type validation: run source TypeScript against explicitly scoped sources and Next ambient types; Next launcher supplies an isolated tsconfig including only the current dist routes. Preserve live generated directories and root config.

Risk: per-job renewal adds one update per interval; final transactions exclude compute/file I/O. Rollback stops recovery/consumers before old code; additive DB columns retained. Migration and actual process control remain approval gates.
