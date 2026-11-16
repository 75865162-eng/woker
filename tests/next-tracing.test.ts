import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import nextConfig from "../next.config";

const require = createRequire(import.meta.url);
const collectorPath = require.resolve("next/dist/build/collect-build-traces");

// 执行已安装的收集器；所有追踪输入及产物只存在内存，不读取真实 uploads。
async function collectFixture(paths: typeof path.win32) {
  const root = paths.resolve(paths === path.win32 ? "C:/trace-fixture" : "/trace-fixture");
  const dist = paths.join(root, ".next-build");
  const entry = "app/api/fixture/route";
  const trace = paths.join(dist, "server", `${entry}.js.nft.json`);
  const references = [
    "uploads/sample.json", "tmp/local.json", "tools/local.js", ".git/HEAD",
    ".next-build/server/chunks/required.js", ".next-build-verify/server/stale.js", "src/runtime.js",
    "node_modules/next/dist/server/next-server.js",
  ].map(file => paths.relative(paths.dirname(trace), paths.join(root, file)).replaceAll("\\", "/"));
  const files = new Map([[trace, JSON.stringify({ version: 1, files: references })]]);
  const localRequire = Object.assign((id: string) => {
    if (id === "path") return paths;
    if (id === "fs/promises") return {
      readFile: async (file: string) => { assert.ok(files.has(file), file); return files.get(file); },
      writeFile: async (file: string, value: string) => { files.set(file, value); },
      readdir: async () => [],
    };
    if (id === "next/dist/compiled/@vercel/nft") return {
      nodeFileTrace: async () => ({ fileList: new Set(), esmFileList: new Set(), reasons: new Map() }),
    };
    return createRequire(collectorPath)(id);
  }, { resolve: createRequire(collectorPath).resolve });
  const collectorModule = { exports: {} as { collectBuildTraces: (options: object) => Promise<void> } };
  vm.runInNewContext(readFileSync(collectorPath, "utf8"), { require: localRequire, module: collectorModule, exports: collectorModule.exports });
  const span = { traceChild: () => span, traceAsyncFn: (fn: () => Promise<void>) => fn() };
  await collectorModule.exports.collectBuildTraces({
    dir: root, distDir: dist, outputFileTracingRoot: root, config: nextConfig,
    edgeRuntimeRoutes: {}, staticPages: [], nextBuildSpan: span,
    buildTraceContext: { chunksTrace: { action: { input: [] }, entryNameFilesMap: { [entry]: [] } } },
  });
  return { references, files: JSON.parse(files.get(trace)!).files as string[] };
}

test("已安装 Next 的排除匹配只移除本地文件，不误删活动 dist 下的必要 chunk", async () => {
  const posixResult = await collectFixture(path.posix);
  assert.deepEqual([...posixResult.files].sort(), [
    posixResult.references.find(file => file.endsWith("chunks/required.js")),
    posixResult.references.find(file => file.includes("node_modules/next/dist/server/next-server.js")),
    posixResult.references.find(file => file.includes("src/runtime.js")),
  ].sort());
  const windowsResult = await collectFixture(path.win32);
  assert.deepEqual([...windowsResult.files].sort(), windowsResult.references.sort(), "Windows collector does not apply POSIX exclusions; release validation must run on Linux");
});
