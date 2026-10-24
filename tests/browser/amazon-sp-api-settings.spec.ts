import { build } from "esbuild";
import { expect, test } from "@playwright/test";

test("LWA-only setup saves credentials, binds a store and validates without starting sync", async ({ page }) => {
  const result = await build({
    stdin: { contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import {AmazonSpApiSettingsPanel} from "./src/components/settings/amazon-sp-api-settings-panel"; createRoot(document.getElementById("root")).render(<AmazonSpApiSettingsPanel/>);', resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
  });
  let saved = false;
  let bindings: unknown[] = [];
  const calls: string[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    expect(url.origin).toBe("http://127.0.0.1:43220");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: result.outputFiles[0].text });
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/bundle.js"></script>' });
    calls.push(`${request.method()} ${url.pathname}`);
    if (url.pathname.endsWith("/credentials")) {
      if (request.method() === "PUT") {
        const body = request.postDataJSON();
        expect(body).toMatchObject({ lwaClientId: "test-client", lwaClientSecret: "test-secret", refreshToken: "test-refresh", awsAccessKeyId: "", awsSecretAccessKey: "" });
        saved = true;
        return route.fulfill({ json: { saved: true } });
      }
      return route.fulfill({ json: { hasSavedCredentials: saved } });
    }
    if (url.pathname.endsWith("/bindings")) {
      if (request.method() === "PUT") {
        bindings = request.postDataJSON().bindings;
        expect(bindings).toEqual([{ sellerAccountId: "store-1", marketplaceId: "ATVPDKIKX0DER", amazonSellerId: "SELLER-1", authorizedResources: ["inventory", "catalog"] }]);
        return route.fulfill({ json: { saved: true } });
      }
      return route.fulfill({ json: {
        scope: { organizationId: "org-1", workspaceId: "workspace-1" }, runtimeConfiguration: { configured: saved, hasEncryptionKey: true, hasDatabaseCredentials: saved, missingEnvironmentVariables: [] },
        connection: null, usingEnvironmentFallback: false, bindings,
        sellerAccounts: [{ id: "store-1", displayName: "测试店铺", accountKey: "store", marketplaceCode: "US", marketplaceId: "ATVPDKIKX0DER" }],
      } });
    }
    if (url.pathname === "/api/operations/connection/validate") return route.fulfill({ json: { validated: true } });
    throw new Error(`Unexpected request: ${request.method()} ${url.pathname}`);
  });
  await page.goto("http://127.0.0.1:43220/");
  await expect(page.getByText(/保存配置不会自动同步/)).toBeVisible();
  await expect(page.getByLabel("AWS Access Key ID", { exact: true })).toBeHidden();
  await page.getByLabel("LWA Client ID", { exact: true }).fill("test-client");
  await page.getByLabel("LWA Client Secret", { exact: true }).fill("test-secret");
  await page.getByLabel("Refresh Token", { exact: true }).fill("test-refresh");
  await page.getByRole("button", { name: "保存 API 凭证", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("加密保存");
  await expect(page.getByLabel("LWA Client Secret", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Refresh Token", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "添加绑定" }).click();
  await page.locator("tbody select").selectOption("store-1");
  await page.getByPlaceholder("Amazon Marketplace ID").fill("ATVPDKIKX0DER");
  await page.getByPlaceholder("真实 Seller ID").fill("SELLER-1");
  await page.getByRole("button", { name: "保存绑定", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("店铺绑定已保存。");
  await page.getByRole("button", { name: "验证 Amazon 连接" }).click();
  await expect(page.getByRole("status")).toHaveText("Amazon 连接验证完成。");
  expect(calls.some((call) => /sync-runs|schedules/.test(call))).toBe(false);
});
