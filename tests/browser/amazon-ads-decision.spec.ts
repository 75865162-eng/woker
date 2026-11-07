import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
let bundle: string, styles: string;
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: ["tests/browser/amazon-ads-decision-harness.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } })).outputFiles[0].text;
  const [{ readFile }, { default: postcss }, { default: tailwind }] = await Promise.all([import("node:fs/promises"), import("postcss"), import("@tailwindcss/postcss")]);
  styles = (await postcss([tailwind()]).process(await readFile("src/app/globals.css", "utf8"), { from: "src/app/globals.css" })).css + await readFile("src/components/amazon-ads/amazon-ads.css", "utf8");
});
async function open(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    expect(url.origin).toBe("http://127.0.0.1:43239");
    if (url.pathname === "/styles.css") return route.fulfill({ contentType: "text/css", body: styles });
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    return route.fulfill({ contentType: "text/html", body: '<html><head><link rel="stylesheet" href="/styles.css"></head><body style="margin:12px"><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto("http://127.0.0.1:43239/");
  return errors;
}
test("S5-S9 uses dry-run, simulated approval, item results and reviewed reverse draft", async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator(".ads-decision-workbench")).toContainText("固定 Fixture");
  await page.getByRole("tab", { name: "商品联动" }).click();
  await expect(page.locator(".ads-simple-table tbody")).toContainText("断货");
  await expect(page.locator(".ads-simple-table tbody")).toContainText("BuyBox 丢失");
  await expect(page.locator(".ads-simple-table tbody")).toContainText("数据未知");
  await page.getByRole("tab", { name: "关键词" }).click();
  await page.getByLabel("选择 drawer organizer").check();
  await expect(page.getByRole("button", { name: "生成 dry-run 草稿" })).toBeDisabled();
  await page.getByLabel("选择 drawer organizer").uncheck();
  await page.getByLabel("选择 storage basket").check();
  await page.getByRole("button", { name: "生成 dry-run 草稿" }).click();
  await page.getByRole("tab", { name: "建议与审批" }).click();
  await expect(page.locator(".ads-decision-orders")).toContainText("Dry-run 影响");
  await page.getByRole("button", { name: "提交模拟审批" }).click();
  await page.getByRole("button", { name: "模拟批准" }).click();
  await page.getByRole("button", { name: "运行逐条模拟执行" }).click();
  await expect(page.locator(".ads-decision-orders")).toContainText("模拟成功");
  await expect(page.locator(".ads-decision-orders")).toContainText("执行前快照");
  await page.getByRole("button", { name: "生成逆向草稿" }).click();
  await expect(page.getByRole("button", { name: "查看 dry-run 并确认影响" })).toBeVisible();
  await page.getByRole("button", { name: "查看 dry-run 并确认影响" }).click();
  await page.getByRole("button", { name: "提交模拟审批" }).last().click();
  await page.getByRole("button", { name: "模拟批准" }).last().click();
  await page.getByRole("button", { name: "运行逐条模拟执行" }).last().click();
  await expect(page.locator(".ads-decision-orders")).toContainText("已模拟回滚");
  await page.getByRole("tab", { name: "审计与回滚" }).click();
  await expect(page.locator(".ads-simple-table tbody")).toContainText("demo.ui.propose");
  expect(errors).toEqual([]);
});

test("S6 marks Stream and official recommendations unavailable without hiding rules", async ({ page }) => {
  const errors = await open(page);
  await page.getByRole("tab", { name: "竞价与预算" }).click();
  await expect(page.locator(".ads-decision-cards")).toContainText("未开通 Marketing Stream");
  await expect(page.locator(".ads-decision-cards")).toContainText("官方推荐 API 尚未接入");
  await expect(page.getByLabel("规则绑定活动")).toBeVisible();
  await page.getByLabel("预算操作").selectOption("update_budget");
  await page.getByLabel("规则绑定活动").selectOption({ label: "Campaign 02" });
  await page.getByLabel("预算规则比例").fill("50");
  await expect(page.getByRole("button", { name: "生成变更 dry-run" })).toBeDisabled();
  await page.getByLabel("规则绑定活动").selectOption({ label: "Campaign 01" });
  await page.getByLabel("预算规则比例").fill("35");
  await page.getByRole("button", { name: "生成变更 dry-run" }).click();
  await page.getByRole("tab", { name: "建议与审批" }).click();
  await expect(page.locator(".ads-decision-orders")).toContainText("调预算");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});
