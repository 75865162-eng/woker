import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { amazonThumbnailUrl } from "../src/lib/amazon-sync/image-url";

/**
 * 用 TS transpile + react-dom/server 渲染纯展示组件 ImageThumb，
 * 断言亚马逊 CDN 原图确实以缩略图 URL 加载，非亚马逊 URL 原样加载。
 */
function loadImageThumb() {
  const source = readFileSync(new URL("../src/components/ui/image-thumb.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source.replace(/^import .*;\r?\n/gm, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  return runInNewContext(`${compiled}; exports.ImageThumb`, {
    exports: {},
    require: (name: string) => {
      assert.equal(name, "react/jsx-runtime");
      return jsxRuntime;
    },
    useState: React.useState,
    cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
    amazonThumbnailUrl,
  }) as (p: Record<string, unknown>) => React.ReactElement;
}

test("ImageThumb loads an Amazon CDN source at thumbnail size", () => {
  const ImageThumb = loadImageThumb();
  const html = renderToStaticMarkup(React.createElement(ImageThumb, {
    src: "https://m.media-amazon.com/images/I/51abc._AC_SL1500_.jpg",
    alt: "B000000001",
    className: "h-14 w-14",
  }));
  assert.match(html, /src="https:\/\/m\.media-amazon\.com\/images\/I\/51abc\._SL240_\.jpg"/);
  assert.doesNotMatch(html, /_SL1500_/);
  assert.match(html, /loading="lazy"/);
});

test("ImageThumb keeps non-Amazon and local sources unchanged", () => {
  const ImageThumb = loadImageThumb();
  const local = renderToStaticMarkup(React.createElement(ImageThumb, {
    src: "/api/operations/products/images/abc123?workspaceId=default",
    alt: "local",
  }));
  assert.match(local, /src="\/api\/operations\/products\/images\/abc123\?workspaceId=default"/);
});

test("ImageThumb honors thumbnailEdge=0 to disable rewriting", () => {
  const ImageThumb = loadImageThumb();
  const html = renderToStaticMarkup(React.createElement(ImageThumb, {
    src: "https://m.media-amazon.com/images/I/51abc._AC_SL1500_.jpg",
    alt: "full",
    thumbnailEdge: 0,
  }));
  assert.match(html, /_SL1500_/);
});

test("商品日主图列使用后端随行返回的 imageUrl（源码契约）", () => {
  const source = readFileSync(
    new URL("../src/components/operations/sales-traffic-workbench.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /header:\s*"主图"[\s\S]{0,200}src=\{row\.imageUrl\}/);
});
