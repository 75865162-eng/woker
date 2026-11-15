import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));

test("五个导出组件保持 props，通过局部边界重挂载业务体且不增加传输", () => {
  for (const [file, name] of [["ads-accounts", "AdsAccounts"], ["ads-campaign-workspace", "AdsCampaignWorkspace"], ["ads-synced-data", "AdsSyncedData"], ["ads-report-acquisition", "AdsReportAcquisition"], ["ads-business-changes", "AdsBusinessChanges"]]) {
    const source = readFileSync(`${root}src/components/amazon-ads/${file}.tsx`, "utf8");
    assert.match(source, new RegExp(`export function ${name}\\(`));
    assert.match(source, new RegExp(`<AdsScopeBoundary><${name}Body(?: \\{\\.\\.\\.props\\})? /></AdsScopeBoundary>`));
  }
  const source = readFileSync(`${root}src/components/amazon-ads/ads-scope-boundary.tsx`, "utf8");
  assert.doesNotMatch(source, /fetch\(|setInterval\(|setTimeout\(/);
});

test("持久化组件在五维 scope 变化后清空状态，迟到响应和旧操作序列不能污染新 scope", async () => {
  const bundle = (await build({
    absWorkingDir: root, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import { createRoot } from 'react-dom/client';
      import { useEffect, useState } from 'react';
      import { AppShellUserProvider } from './src/components/app-shell/app-shell-context';
      import { AdsScopeBoundary, useAdsScopeCurrent } from './src/components/amazon-ads/ads-scope-boundary';
      import { AdsAccounts } from './src/components/amazon-ads/ads-accounts';
      import { AdsReportAcquisition } from './src/components/amazon-ads/ads-report-acquisition';
      import { workspaceScopeStorageKey } from './src/lib/workspace/workspace-scope-store';
      import { emitWorkspaceScopeChanged } from './src/lib/workspace/workspace-scope-events';
      let resolveOld; window.writes = 0; window.mounts = 0;
      const pending = new Promise(resolve => { resolveOld = resolve; });
      window.finishOld = () => resolveOld('旧响应');
      function Probe() {
        const current = useAdsScopeCurrent();
        const [filter, setFilter] = useState('');
        const [value, setValue] = useState('');
        useEffect(() => { window.mounts++; }, []);
        return <><input id="filter" value={filter} onChange={e => setFilter(e.target.value)} />
          <span id="value">{value}</span><button id="start" onClick={async () => {
            const value = await pending; setValue(value);
            if (current()) window.writes++;
          }}>start</button></>;
      }
      function Harness() {
        const [user, setUser] = useState({ organizationId: 'org-a', userId: 'user-a', userInitials: 'A' });
        window.identity = patch => setUser(value => ({ ...value, ...patch }));
        window.scope = patch => {
          const current = JSON.parse(localStorage.getItem(workspaceScopeStorageKey));
          const next = { ...current, ...patch };
          localStorage.setItem(workspaceScopeStorageKey, JSON.stringify(next));
          emitWorkspaceScopeChanged({ ...next, source: 'manual' });
        };
        return <AppShellUserProvider value={user}><AdsScopeBoundary><Probe /></AdsScopeBoundary><AdsAccounts /><AdsReportAcquisition /></AppShellUserProvider>;
      }
      localStorage.setItem(workspaceScopeStorageKey, JSON.stringify({ workspaceId: 'ws-a', accountId: 'account-a', marketplace: 'US' }));
      createRoot(document.getElementById('root')).render(<Harness />);
    ` },
  })).outputFiles[0].text;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const requests: Array<{ path: string; scope: string; method: string }> = [];
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, "http://127.0.0.1:43239");
      if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
      if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/bundle.js"></script>' });
      requests.push({ path: url.pathname, scope: request.headers()["x-workspace-id"], method: request.method() });
      assert.equal(request.method(), "GET");
      const body = url.pathname.endsWith("/profiles") ? { profiles: [], sellers: [], oauthConfigured: false, autoSyncConfigured: false }
        : url.pathname.endsWith("/reports") ? { profiles: [], reportTypes: [], mode: "fixture", executionRole: "fixture", oauthConfigured: false }
        : { plans: [], freshness: [], taskHistory: [], taskPagination: { page: 1, pageSize: 20, total: 0, pageCount: 0, hasMore: false } };
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto("http://127.0.0.1:43239/");
    await page.waitForFunction(() => (window as unknown as { mounts: number }).mounts === 1);
    await page.locator("#filter").fill("A筛选");
    await page.locator("#start").click();
    for (const [method, patch] of [["scope", { workspaceId: "ws-b" }], ["scope", { accountId: "account-b" }], ["scope", { marketplace: "DE" }], ["identity", { organizationId: "org-b" }], ["identity", { userId: "user-b" }]] as const) {
      const mounts = await page.evaluate(() => (window as unknown as { mounts: number }).mounts);
      await page.evaluate(({ method, patch }) => (window as unknown as Record<string, (patch: unknown) => void>)[method](patch), { method, patch });
      await page.waitForFunction(count => (window as unknown as { mounts: number }).mounts === count + 1, mounts);
      assert.equal(await page.locator("#filter").inputValue(), "");
      await page.locator("#filter").fill("新筛选");
    }
    await page.evaluate(() => (window as unknown as { finishOld: () => void }).finishOld());
    assert.equal(await page.locator("#value").textContent(), "");
    assert.equal(await page.evaluate(() => (window as unknown as { writes: number }).writes), 0);
    // 同一 scope 事件不重挂载，不增加读取；旧作用域请求不会触发新的写入。
    const mounts = await page.evaluate(() => (window as unknown as { mounts: number }).mounts);
    await page.evaluate(() => (window as unknown as { scope: (patch: object) => void }).scope({}));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => (window as unknown as { mounts: number }).mounts), mounts);
    assert.equal(requests.filter(row => row.scope === "ws-a").length, 3);
    assert.ok(requests.some(row => row.scope === "ws-b"));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
