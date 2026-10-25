import { build } from "esbuild";
import { expect, test } from "@playwright/test";

// Render the real table with narrow API-shaped rows. No live API or remote image fetch.
test("Listing promoted fields, NULL and unsupported gray fields remain distinct", async ({ page }) => {
  const result = await build({ stdin: { contents: `
    import { createRoot } from "react-dom/client";
    import { SellfoxResourceTable } from "./src/components/sellfox/resource-table";
    const rows = [
      { id:"present", asin:"B0TEST", msku:"exact-msku", fnsku:"FN-EVIDENCE", parentSku:"PARENT-EVIDENCE", mainImage:"https://m.media-amazon.com/images/I/test.jpg" },
      { id:"missing", asin:"B0EMPTY", msku:"empty-msku", fnsku:null, parentSku:null, mainImage:null }
    ];
    createRoot(document.getElementById("root")).render(<SellfoxResourceTable domain="listings" rows={rows} selectedColumns={["image","asin","fnsku","parentSku","productTags"]} pagination={{page:1,pageSize:50,total:2}} loading={false} page={1} onPage={()=>{}} onSelect={()=>{}} />);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic" });
  const [{ readFile }, { default: postcss }, { default: tailwind }] = await Promise.all([import("node:fs/promises"), import("postcss"), import("@tailwindcss/postcss")]);
  const css = (await postcss([tailwind()]).process(await readFile("src/app/globals.css", "utf8"), { from: "src/app/globals.css" })).css;
  const remote: string[] = [];
  await page.route("**/*", route => { remote.push(route.request().url()); return route.abort(); });
  await page.setContent('<html><head></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: result.outputFiles[0].text });
  await expect(page.getByText("FN-EVIDENCE", { exact: true })).toBeVisible();
  await expect(page.getByText("PARENT-EVIDENCE", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "图", exact: true })).toHaveAttribute("href", "https://m.media-amazon.com/images/I/test.jpg");
  await expect(page.getByRole("link", { name: "图", exact: true })).toHaveAttribute("rel", "noreferrer noopener");
  await expect(page.locator('img')).toHaveCount(0);
  await expect(page.getByTitle("当前快照未提供有效主图URL（NEEDS_DATA）")).toHaveText("—");
  const emptyRow = page.getByRole("row").filter({ hasText: "empty-msku" });
  await expect(emptyRow.locator("td").filter({ hasText: /^—$/ })).toHaveCount(4);
  await expect(page.getByTitle("赛狐有、API/本地无", { exact: true }).first()).toBeVisible();
  expect(remote).toEqual([]);
});
