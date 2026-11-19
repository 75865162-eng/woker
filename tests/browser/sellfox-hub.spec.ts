import { build } from "esbuild";
import { expect, test } from "@playwright/test";
let bundle: string;
test.beforeAll(async () => {
  const result = await build({ entryPoints: ["tests/browser/sellfox-hub-harness.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
  bundle = result.outputFiles[0].text;
});
for (const failed of [false, true]) test(`store sync shows ${failed ? "persistent failure" : "queued task"} beside its button`, async ({ page }) => {
  let syncCalls = 0;
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== "http://fixture.local") return route.abort();
    if (url.pathname === "/api/sellfox/hub") return route.fulfill({ json: { configured: true, credentialSource: "database", encryptionReady: true, workerOnline: true, stores: [], storeCount: 0, datasets: [], hourlyRows: 0, plan: { total: 1, live: 1, planned: 0, blocked: 0 }, lastSuccess: {}, runs: [] } });
    if (url.pathname === "/api/sellfox/sync") {
      syncCalls++;
      expect(request.method()).toBe("POST");
      expect(request.headers()["x-workspace-id"]).toBe("fixture-workspace");
      expect(request.postDataJSON()).toEqual({ resource: "stores", workspaceId: "fixture-workspace" });
      return route.fulfill(failed ? { status: 503, json: { error: "同步队列暂不可用" } } : { status: 202, json: { runId: "fixture-run", status: "queued" } });
    }
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div></body></html>' });
  });
  await page.goto("http://fixture.local/sellfox");
  await page.addScriptTag({ content: bundle });
  const card = page.locator("div").filter({ has: page.locator("p").filter({ hasText: /^店铺列表/ }) }).filter({ has: page.getByRole("button", { name: "同步", exact: true }) }).last();
  await card.getByRole("button", { name: "同步", exact: true }).click();
  await expect(card.getByRole(failed ? "alert" : "status")).toContainText(failed ? "同步队列暂不可用" : "fixture-run");
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(card.getByRole(failed ? "alert" : "status")).toBeVisible();
  if (failed) await expect(page.getByRole("alert").first()).toContainText("同步队列暂不可用");
  expect(syncCalls).toBe(1);
});
