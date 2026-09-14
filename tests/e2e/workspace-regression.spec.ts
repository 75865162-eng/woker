import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const testEmail = process.env.E2E_TEST_EMAIL;
const testPassword = process.env.E2E_TEST_PASSWORD;
const testFiles = {
  bulk: path.join(process.cwd(), "tests/fixtures/e2e-bulk.xlsx"),
  grouping: path.join(process.cwd(), "tests/fixtures/e2e-grouping.csv"),
  overall: path.join(process.cwd(), "tests/fixtures/e2e-overall.csv"),
};

test.describe("PPC workspace regression", () => {
  test.skip(!testEmail || !testPassword, "Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD to run against an isolated test account.");

  async function login(page: Page) {
    await page.goto("/login");
    await page.getByLabel("账号 / 手机号").fill(testEmail!);
    await page.getByLabel("密码").fill(testPassword!);
    await page.locator("form").getByRole("button", { name: "登录", exact: true }).last().click();
    await expect(page).not.toHaveURL(/\/login/);
  }

  test("logs in, uploads, saves, restores, and exports a test workbook", async ({ page }) => {
    page.on("dialog", async (dialog) => {
      await dialog.accept();
    });

    await login(page);
    await page.goto("/workspace");
    await expect(page).toHaveURL(/\/workspace(?:\?.*)?$/);

    const fileInputs = page.locator('input[type="file"]');
    await fileInputs.nth(0).setInputFiles(testFiles.bulk);
    await expect(page.getByText("Test Campaign")).toBeVisible();
    await expect(page.getByText("Test Ad Group")).toBeVisible();

    await fileInputs.nth(1).setInputFiles(testFiles.grouping);
    await expect(page.getByText(/新品组 · \d+ 条启用规则/)).toBeVisible();

    await page.getByRole("button", { name: "上传匹配所有广告组" }).click();
    await fileInputs.nth(2).setInputFiles(testFiles.overall);
    await expect(page.getByText("状态：已匹配")).toBeVisible();
    await expect(page.getByText(/已匹配 1 个广告组/)).toBeVisible();

    await expect(page.getByText("已保存到数据库")).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(page.getByText("Test Campaign")).toBeVisible();
    await expect(page.getByText("状态：已匹配")).toBeVisible();

    await page.locator('button[title="运行规则"]').click();
    const draftCheckbox = page.locator('input[type="checkbox"]').first();
    await expect(draftCheckbox).toBeVisible();
    await draftCheckbox.check();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出 Bulk 文件" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^已修改-e2e-bulk\.xlsx$/);
  });

  test("product editor uploads a batch of images and renders thumbnails", async ({ page }) => {
    let uploadIndex = 0;
    await page.route("**/api/products/image-assets/upload", async (route) => {
      uploadIndex += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          asset: {
            id: `e2e-image-${uploadIndex}`,
            name: `e2e-image-${uploadIndex}.png`,
            mimeType: "image/png",
            size: 68,
            storageType: "local",
            uploadedAt: "2026-09-13T00:00:00.000Z",
            thumbUrl: `/e2e-image-${uploadIndex}.png`,
            originalUrl: `/e2e-image-${uploadIndex}.png`,
            downloadUrl: `/e2e-image-${uploadIndex}.png`,
          },
        }),
      });
    });

    await login(page);
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "新增商品", exact: true }).click();

    const imageInput = page.locator('input[type="file"][accept="image/*"]').last();
    await imageInput.setInputFiles([
      { name: "one.png", mimeType: "image/png", buffer: Buffer.from("one") },
      { name: "two.png", mimeType: "image/png", buffer: Buffer.from("two") },
    ]);

    await expect(page.locator('img[alt="商品图片 1"]')).toBeVisible();
    await expect(page.locator('img[alt="商品图片 2"]')).toBeVisible();
    expect(uploadIndex).toBe(2);
  });
});
