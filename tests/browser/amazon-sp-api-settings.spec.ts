import { build } from "esbuild";
import { expect, test } from "@playwright/test";

test("legacy settings surface links to the unified approval center without API calls", async ({ page }) => {
  const result = await build({
    stdin: { contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import {AmazonSpApiSettingsPanel} from "./src/components/settings/amazon-sp-api-settings-panel"; createRoot(document.getElementById("root")).render(<AmazonSpApiSettingsPanel/>);', resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
  });
  const calls: string[] = [];
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    expect(url.origin).toBe("http://127.0.0.1:43220");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: result.outputFiles[0].text });
    if (url.pathname.startsWith("/api/")) calls.push(`${request.method()} ${url.pathname}`);
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/bundle.js"></script>' });
  });
  await page.goto("http://127.0.0.1:43220/");
  await expect(page.getByRole("heading", { name: "Amazon 数据处理中心" })).toBeVisible();
  await expect(page.getByRole("link", { name: /打开数据处理中心/ })).toHaveAttribute("href", "/operations?view=connections");
  await expect(page.getByRole("link", { name: /变更审批/ })).toHaveAttribute("href", "/settings?tab=integrations#amazon-approvals");
  expect(calls).toEqual([]);
});

test("settings-integrated approvals panel reads, approves and applies through the existing API", async ({ page }) => {
  const result = await build({
    stdin: { contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import {AmazonApprovalsPanel} from "./src/components/settings/amazon-approvals-panel"; createRoot(document.getElementById("root")).render(<AmazonApprovalsPanel/>);', resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
  });
  const decisions: string[] = [];
  let status = "REQUESTED";
  const change = { id: "approval-1", targetEnvironment: "local", changeType: "CredentialChange", operation: "enable-authorization", targetId: "auth-a", beforeSummary: { status: "DISABLED" }, afterSummary: { status: "NOT_CONFIGURED" }, sellerIds: ["SELLER-a"], marketplaceIds: ["US"], domains: ["inventory"], sourceIds: [], baseRevision: 1, changeDigest: "fixture-digest", requestedByUserId: "requester", approvedByUserId: status === "APPROVED" ? "approver" : null, status, expiresAt: "2026-11-27T02:00:00Z", appliedAt: null, createdAt: "2026-11-20T01:00:00Z" };
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    expect(url.origin).toBe("http://127.0.0.1:43220");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: result.outputFiles[0].text });
    if (url.pathname === "/api/operations/sync-center/approvals") {
      const body = request.postDataJSON() as { decision?: string };
      decisions.push(String(body.decision));
      status = body.decision === "APPROVED" ? "APPROVED" : body.decision === "APPLY" ? "APPLIED" : status;
      return route.fulfill({ json: { request: { ...change, status } } });
    }
    if (url.pathname === "/api/operations/sync-center") {
      expect(new URL(request.url()).searchParams.get("section")).toBe("approvals");
      return route.fulfill({ json: { access: { canApprove: true, canConfigure: true, canEdit: true, canCreate: true }, requests: [{ ...change, status }] } });
    }
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/bundle.js"></script>' });
  });
  await page.goto("http://127.0.0.1:43220/");
  const panel = page.getByTestId("settings-amazon-approvals");
  await expect(panel.getByText("enable-authorization")).toBeVisible();
  await expect(panel.getByRole("button", { name: "批准", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "应用已批准变更", exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "批准", exact: true }).click();
  await expect(panel.getByRole("button", { name: "应用已批准变更", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "应用已批准变更", exact: true }).click();
  await expect(panel.getByText("已应用本次批准变更。")).toBeVisible();
  expect(decisions).toEqual(["APPROVED", "APPLY"]);
});
