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
  expect(calls).toEqual([]);
});
