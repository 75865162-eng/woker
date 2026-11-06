import { startIsolatedReportWorker } from "../../src/lib/amazon-ads/report-worker";
import type { IsolatedReportTransport } from "../../src/lib/amazon-ads/report-acquisition";

// Only the disposable integration runner can start this process. No dotenv/live transport.
if (process.env.AMAZON_SYNC_OFFLINE_FIXTURE !== "1" || process.env.AMAZON_SYNC_TEST_REDIS_DISPOSABLE !== "1" || !process.send) throw new Error("Disposable IPC fixture required");
process.once("message", (config: { scope: { organizationId: string; workspaceId: string }; stopAt: "create" | "download" }) => {
  const stop = async (operation: string): Promise<Response> => {
    process.send!({ operation });
    return new Promise<Response>(() => { /* Parent kills after durable reservation and transport invocation. */ });
  };
  const transport: IsolatedReportTransport = {
    evidence: "ISOLATED_FIXTURE_ONLY",
    create: () => stop("create"), poll: () => stop("unexpected-poll"),
    download: () => stop("download"),
  };
  void startIsolatedReportWorker({ scope: config.scope, transport, intervalMs: 100 }).catch(() => {
    process.send!({ operation: "startup-failed" }); process.exitCode = 1;
  });
});
