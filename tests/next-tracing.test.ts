import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
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

test("standalone 清理删除环境文件但保留运行文件和项目源环境文件", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "erp-standalone-boundary-"));
  try {
    const distDir = ".next-build";
    const standalone = path.join(root, distDir, "standalone");
    await mkdir(standalone, { recursive: true });
    await writeFile(path.join(root, ".env"), "SOURCE_FIXTURE_ONLY=1");
    for (const name of [".env", ".env.local", ".env.production", ".env.example", "server.js", "package.json"]) {
      await writeFile(path.join(standalone, name), "fixture");
    }
    for (const name of [distDir, "node_modules", ".git", "tmp", "uploads", "tools", ".next-old"]) {
      await mkdir(path.join(standalone, name));
    }
    const source = readFileSync(path.resolve("scripts/next-run.mjs"), "utf8");
    const start = source.indexOf("async function cleanupStandaloneOutput()");
    const end = source.indexOf('\nfor (const signal', start);
    assert.ok(start >= 0 && end > start);
    const cleanup = vm.runInNewContext(`(${source.slice(start, end).trim()})`, {
      args: ["build"], distDir, process: { cwd: () => root },
      path, existsSync, readdir, rm,
    }) as () => Promise<void>;
    await cleanup();
    assert.deepEqual((await readdir(standalone)).sort(), [distDir, "node_modules", "package.json", "server.js"].sort());
    assert.equal(readFileSync(path.join(root, ".env"), "utf8"), "SOURCE_FIXTURE_ONLY=1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("隔离 Next 配置的相对 baseUrl 从配置目录解析到项目源码", async () => {
  const ts = require("typescript") as typeof import("typescript");
  const source = readFileSync(path.resolve("scripts/next-run.mjs"), "utf8");
  const start = source.indexOf("await writeFile(typeConfig, JSON.stringify(");
  const end = source.indexOf("const child = spawn", start);
  assert.ok(start >= 0 && end > start);
  for (const paths of [path.posix, path.win32]) {
    const root = paths === path.win32 ? "C:\\fixture\\project" : "/fixture/project";
    const typeDirectory = paths.join(root, ".next-types-fixture");
    const typeConfig = paths.join(typeDirectory, "tsconfig.json");
    let config: { compilerOptions: { baseUrl: string; paths: Record<string, string[]> } } | undefined;
    await vm.runInNewContext(`(async () => { ${source.slice(start, end)} })()`, {
      typeConfig, typeDirectory, ambient: paths.join(typeDirectory, "next.d.ts"),
      distDir: ".next-dev-fixture", path: paths, process: { cwd: () => root },
      writeFile: async (_file: string, content: string) => { config = JSON.parse(content); },
    });
    assert.ok(config);
    assert.equal(paths.isAbsolute(config.compilerOptions.baseUrl), false);
    const baseUrl = paths.resolve(typeDirectory, config.compilerOptions.baseUrl).replaceAll("\\", "/");
    const expected = paths.join(root, "src", "fixture.ts").replaceAll("\\", "/");
    assert.equal(baseUrl, root.replaceAll("\\", "/"));
    const resolved = ts.resolveModuleName("@/fixture", paths.join(root, "src", "entry.ts").replaceAll("\\", "/"), {
      baseUrl, paths: config.compilerOptions.paths, moduleResolution: ts.ModuleResolutionKind.Bundler,
    }, { fileExists: file => file === expected, readFile: () => "export {};" });
    assert.equal(resolved.resolvedModule?.resolvedFileName, expected);
  }
});

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
