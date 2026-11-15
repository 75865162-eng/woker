#!/usr/bin/env node
/**
 * UI 一致性闸门（基线比对，只做防回退，不阻断既有存量）。
 *
 * 背景：全站 UI 审计发现的问题里，最贵的不是"某一页难看"，而是"改完还会再漂回去"。
 * 本脚本固化一组可量化的 UI 指标，与 ui-baseline.json 比对：
 *   - 任一指标上升  → 退出码 1（说明新代码又引入了旧范式）
 *   - 任一指标下降  → 提示更新基线（说明有人做了迁移，应把新数字记下来）
 *
 * 用法：
 *   node scripts/runtime/ui-guard.mjs            比对基线
 *   node scripts/runtime/ui-guard.mjs --update   以当前状态重写基线
 *   node scripts/runtime/ui-guard.mjs --json     机器可读输出
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SRC = path.join(ROOT, "src");
const BASELINE = path.join(ROOT, "scripts/runtime/ui-baseline.json");

/** 指标定义：name → { label, pattern, scope } */
const METRICS = [
  {
    name: "nativeTables",
    label: "原生 <table> 标签数",
    pattern: /<table[\s>]/g,
    files: [".tsx"],
  },
  {
    name: "rawPalette",
    label: "非令牌调色板类引用",
    pattern:
      /\b(?:bg|text|border|from|to|via|ring|divide|outline|decoration|shadow)-(?:red|amber|emerald|green|orange|yellow|rose|blue|slate|gray|zinc|neutral|indigo|violet|purple|teal|cyan|pink|lime|sky)-(?:50|[1-9]00)\b/g,
    files: [".tsx"],
  },
  {
    name: "arbitraryText",
    label: "硬编码字号 text-[Npx]",
    pattern: /\btext-\[\d+(?:\.\d+)?px\]/g,
    files: [".tsx"],
  },
  {
    name: "hexInTsx",
    label: "TSX 内硬编码十六进制色",
    pattern: /#[0-9a-fA-F]{6}\b/g,
    files: [".tsx"],
  },
  {
    name: "shadcnResidue",
    label: "shadcn 遗留类引用",
    pattern: /\b(?:text-muted-foreground|border-input|bg-card|text-primary|bg-muted)(?![a-z-])/g,
    files: [".tsx"],
  },
  {
    name: "legacyWhiteBg",
    label: "裸白底 bg-white（应为 bg-surface）",
    pattern: /\bbg-white\b/g,
    files: [".tsx"],
  },
  {
    name: "arbitraryTwValue",
    label: "任意值类 xxx-[…]（应走令牌）",
    // 排除 ref var(--…) 形式：那是引用令牌，不是魔法值
    pattern: /\b(?:bg|text|border|ring|shadow|rounded|from|to|via)-\[(?!var\()[^\]]*\]/g,
    files: [".tsx"],
  },
  {
    name: "nonTokenRadius",
    label: "非令牌圆角（2xl 及以上）",
    pattern: /\brounded-(?:2xl|3xl|4xl)\b/g,
    files: [".tsx"],
  },
  {
    name: "boldDecls",
    label: "加粗声明（font-bold 及以上）",
    pattern: /\bfont-(?:bold|extrabold|black)\b/g,
    files: [".tsx"],
  },
  {
    name: "legacySfVars",
    label: "旧 --sf-* 变量引用",
    pattern: /--sf-[a-z-]+/g,
    files: [".tsx", ".css"],
  },
  {
    name: "adsCssRules",
    label: "广告模块自有 CSS 规则数",
    /*
     * 广告模块刻意保留 Amazon Ads 的品牌视觉，因此它的 CSS 不并入 ERP 令牌层。
     * 这个指标只防「广告 CSS 继续膨胀」。
     * 658 → 664 的 6 条是壳层改版（顶栏 48 + 标签栏 36）后的对齐补丁，
     * 位置见 amazon-ads.css 末尾「与新版 ERP 壳层对齐」段，属一次性改动。
     */
    pattern: /\{/g,
    files: [".css"],
    onlyIn: ["src/components/amazon-ads/amazon-ads.css"],
  },
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

/*
 * 设计系统自检页会把类名、十六进制色值当作文档内容展示出来，
 * 计入指标会造成假阳性（文档写得越清楚，"违规"越多）。整体排除。
 */
const EXCLUDED = ["src/components/design/", "src/app/(erp)/design/"];

const files = walk(SRC)
  .map((file) => ({ full: file, rel: path.relative(ROOT, file).split(path.sep).join("/") }))
  .filter((file) => !EXCLUDED.some((prefix) => file.rel.startsWith(prefix)));

const current = {};
for (const metric of METRICS) {
  let total = 0;
  for (const file of files) {
    if (!metric.files.some((ext) => file.rel.endsWith(ext))) continue;
    if (metric.onlyIn && !metric.onlyIn.includes(file.rel)) continue;
    const content = fs.readFileSync(file.full, "utf8");
    const matches = content.match(metric.pattern);
    if (matches) total += matches.length;
  }
  current[metric.name] = total;
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(current, null, 2));
  process.exit(0);
}

if (process.argv.includes("--update")) {
  fs.writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`已写入基线 ${path.relative(ROOT, BASELINE)}`);
  for (const metric of METRICS) console.log(`  ${metric.name.padEnd(16)} ${current[metric.name]}`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.error(`缺少基线文件：${path.relative(ROOT, BASELINE)}`);
  console.error("首次使用请运行：node scripts/runtime/ui-guard.mjs --update");
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
const regressions = [];
const improvements = [];

console.log("UI 一致性闸门");
console.log("─".repeat(58));
console.log(`${"指标".padEnd(30)}${"基线".padStart(8)}${"当前".padStart(8)}${"差值".padStart(10)}`);
for (const metric of METRICS) {
  const before = baseline[metric.name] ?? 0;
  const now = current[metric.name] ?? 0;
  const delta = now - before;
  const mark = delta > 0 ? `+${delta} ✗` : delta < 0 ? `${delta} ✓` : "0";
  console.log(`${metric.label.padEnd(28)}${String(before).padStart(10)}${String(now).padStart(8)}${mark.padStart(10)}`);
  if (delta > 0) regressions.push({ metric, before, now, delta });
  if (delta < 0) improvements.push({ metric, before, now, delta });
}
console.log("─".repeat(58));

if (improvements.length) {
  console.log(`\n有 ${improvements.length} 项指标下降，迁移已生效。请更新基线：node scripts/runtime/ui-guard.mjs --update`);
}

if (regressions.length) {
  console.error("\n发现 UI 范式回退：");
  for (const item of regressions) {
    console.error(`  · ${item.metric.label}：${item.before} → ${item.now}（+${item.delta}）`);
  }
  console.error("\n新增代码请改用设计系统原语：");
  console.error("  表格        src/components/ui/data-table.tsx / table-variants.tsx");
  console.error("  页面骨架    src/components/templates/page-templates.tsx");
  console.error("  表单控件    src/components/ui/form-controls.tsx");
  console.error("  浮层        src/components/ui/overlays.tsx");
  console.error("  页面骨架件  src/components/ui/page-chrome.tsx");
  console.error("  工具条      src/components/ui/toolbar.tsx");
  console.error("  指标条      src/components/ui/stat-strip.tsx");
  console.error("  区块容器    src/components/ui/section.tsx");
  console.error("  状态标记    src/components/ui/status-pill.tsx");
  console.error("  提示条      src/components/ui/alert.tsx");
  console.error("  空状态      src/components/ui/empty-state.tsx");
  process.exit(1);
}

console.log("\n通过：未引入新的 UI 范式回退。");
