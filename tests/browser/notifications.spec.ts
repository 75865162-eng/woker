import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";

let bundle: string;
let styles: string;
test.beforeAll(async () => {
  const result = await build({ entryPoints: ["tests/browser/notification-harness.tsx"], bundle: true, write: false,
    platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  bundle = result.outputFiles[0].text;
  const [{ readFile }, { default: postcss }, { default: tailwind }] = await Promise.all([import("node:fs/promises"), import("postcss"), import("@tailwindcss/postcss")]);
  const plugin = tailwind() as unknown as import("postcss").AcceptedPlugin;
  styles = (await postcss([plugin]).process(await readFile("src/app/globals.css", "utf8"), { from: "src/app/globals.css" })).css;
});
async function setup(page: Page) {
  const state = { session: "session-1", completed: false, patches: 0, loads: 0, fail: false };
  await page.clock.install();
  await page.route("http://127.0.0.1:43229/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/styles.css") return route.fulfill({ contentType: "text/css", body: styles });
    if (pathname === "/api/notifications/user") {
      if (route.request().method() === "PATCH") { state.patches++; return route.fulfill({ json: { ok: true } }); }
      state.loads++;
      if (state.fail) return route.fulfill({ status: 503, json: {} });
      const notification = { id: "n1", type: "product_workflow", title: "待处理商品任务", message: "请处理 SKU-1",
        readAt: "2026-10-01T00:00:00Z", createdAt: "2026-10-01T00:00:00Z",
        metadata: { sku: "SKU-1", workspaceId: "w", dueAt: "2026-11-01T00:00:00Z" } };
      return route.fulfill({ json: { notifications: [notification], unreadCount: 0,
        pendingWorkflowNotifications: state.completed ? [] : [notification], notificationSessionKey: state.session } });
    }
    return route.fulfill({ contentType: "text/html", body: `<link rel="stylesheet" href="/styles.css"><div id="root"></div><script>${bundle}</script>` });
  });
  await page.goto("http://127.0.0.1:43229/");
  return state;
}

test("close does not mark read; polling, navigation and reload stay quiet; next login reminds again", async ({ page }) => {
  const state = await setup(page);
  await expect(page.getByText("业务流转提醒", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭提醒", exact: true }).click();
  expect(state.patches).toBe(0);
  await page.clock.runFor(15000);
  await expect.poll(() => state.loads).toBeGreaterThan(1);
  await expect(page.getByText("业务流转提醒", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "通知", exact: true })).toBeVisible();
  await expect(page.getByText("业务流转提醒", { exact: true })).toHaveCount(0);
  state.session = "session-2";
  await page.reload();
  await expect(page.getByText("业务流转提醒", { exact: true })).toBeVisible();
  state.completed = true;
  await page.clock.runFor(15000);
  await expect(page.getByText("业务流转提醒", { exact: true })).toHaveCount(0);
  state.session = "session-3";
  await page.reload();
  await expect(page.getByRole("button", { name: "通知", exact: true })).toBeVisible();
  await expect(page.getByText("业务流转提醒", { exact: true })).toHaveCount(0);
});

test("Escape and backdrop dismiss without writes; a failed request does not consume the reminder", async ({ page }) => {
  const state = await setup(page);
  await expect(page.getByText("业务流转提醒", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("业务流转提醒", { exact: true })).toHaveCount(0);
  expect(state.patches).toBe(0);
  state.session = "session-2"; state.fail = true;
  await page.reload();
  await expect(page.getByRole("button", { name: "通知", exact: true })).toBeVisible();
  state.fail = false;
  await page.clock.runFor(15000);
  await expect(page.getByText("业务流转提醒", { exact: true })).toBeVisible();
  await page.locator(".fixed.inset-0").click({ position: { x: 5, y: 5 } });
  await expect(page.getByText("业务流转提醒", { exact: true })).toHaveCount(0);
  expect(state.patches).toBe(0);
});
