import { build } from "esbuild";
import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { LocalResearchStore } from "../../src/lib/selection-research/file-store";
import { ResearchEngine } from "../../src/lib/selection-research/engine";
import { researchFixture } from "../../src/lib/selection-research/fixture";
import { renderResearchReport } from "../../src/lib/selection-research/report";
import { SKILLS, type Decision, type Run } from "../../src/lib/selection-research/types";

let bundle: string;
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: ["tests/browser/selection-research-harness.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } })).outputFiles[0].text;
});
test("isolated UI exercises actual engine through both gates, reload recovery, download and workspace clearing", async ({ page }) => {
  const root = await mkdtemp(path.join(tmpdir(), "research-browser-"));
  try {
    const fixture = researchFixture();
    const engine = new ResearchEngine(new LocalResearchStore(root), { organizationId: "mock-org", workspaceId: "default", ownerId: "mock-owner" }, fixture.transport, fixture.agent, { mode: "fixture" });
    let run: Run | undefined;
    let steps = 0;
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== "selection.invalid") throw new Error("UNEXPECTED_NETWORK_REQUEST");
      if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: `<div id="root"></div><script>${bundle}</script>` });
      if (route.request().method() === "GET") {
        if (url.pathname.endsWith("/report")) {
          const html = renderResearchReport(await engine.inspect(run!.id));
          return route.fulfill({ contentType: "text/html", headers: { "content-disposition": 'attachment; filename="selection.html"' }, body: html });
        }
        if (url.pathname === "/api/selection-research") return route.fulfill({ json: { runs: run ? [{ id: run.id, status: run.status, input: { requirement: run.requirement } }] : [] } });
        return route.fulfill({ json: { run: await engine.inspect(run!.id) } });
      }
      const body = route.request().postDataJSON();
      if (url.pathname === "/api/selection-research") run = await engine.create({ requirement: body.requirement, marketplace: body.marketplace, policies: fixture.policies, limits: {}, skills: SKILLS.map((name) => ({ name, path: `fixture/${name}`, markdown: "fixture", sha256: createHash("sha256").update("fixture").digest("hex"), tools: [] })) });
      else if (body.operation === "step") { steps++; run = await engine.step(run!.id); }
      else if (body.operation === "decide") run = await engine.decide(run!.id, body.decision as Decision);
      else if (body.operation === "export") return route.fulfill({ json: { fileId: "mock-file-id" } });
      else return route.fulfill({ status: 400, json: { error: "Unexpected test operation" } });
      return route.fulfill({ json: { run } });
    });
    await page.goto("http://selection.invalid/");
    await page.getByLabel("自然语言选品要求").fill("美国站宠物用品，离线流程验证");
    await page.getByRole("button", { name: "创建隔离样本任务" }).click();
    await page.getByRole("button", { name: "继续到下一确认节点" }).click();
    await expect(page.getByRole("heading", { name: "需要人工确认：NICHE" })).toBeVisible();
    expect(steps).toBe(2); expect(run!.stage).toBe(1);
    await expect(page.getByText("下载单文件 HTML 报告", { exact: true })).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: /美国站宠物用品.*WAITING_FOR_USER/ }).click();
    await expect(page.getByRole("heading", { name: "需要人工确认：NICHE" })).toBeVisible();
    await page.getByRole("button", { name: /选择：流程测试方向 2/ }).click();
    await page.getByRole("button", { name: "继续到下一确认节点" }).click();
    await expect(page.getByRole("heading", { name: "需要人工确认：FINAL" })).toBeVisible();
    expect(run!.status).toBe("WAITING_FOR_USER"); expect(run!.results).toHaveLength(5);
    await page.getByRole("button", { name: "确认研究结果，允许生成报告" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "下载单文件 HTML 报告" }).click();
    expect((await download).suggestedFilename()).toBe("selection.html");
    await page.getByRole("button", { name: "另存到现有文件存储" }).click();
    await expect(page.getByRole("status")).toContainText("mock-file-id");
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("amazon-bulk-ad:workspace-scope-changed")));
    await expect(page.getByRole("heading", { name: /第 5 \/ 5 阶段/ })).toHaveCount(0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
