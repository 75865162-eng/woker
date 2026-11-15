/**
 * Generate a production systemd EnvironmentFile from the reviewed template.
 *
 *   npm run prod:env:init -- --output /etc/tiaotiao/erp.env --apply
 *   npm run prod:env:init -- --output /etc/tiaotiao/erp.env --apply --force
 *
 * Dry-run by default: nothing is written without --apply. Every GENERATE:<n>:<enc>
 * token becomes a cryptographically random value; REPLACE: tokens are preserved
 * for the operator and reported at the end. Never prints secret values.
 */
import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
import path from "node:path";
import { projectRoot } from "./environment.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? (args[idx + 1] && !args[idx + 1].startsWith("--") ? args[idx + 1] : true) : fallback;
};
const has = name => args.includes(`--${name}`);

const templatePath = path.resolve(String(flag("template", path.join(projectRoot, "deploy/production.env.example"))));
const outputPath = flag("output", path.join(projectRoot, "deploy/production.env"));
const target = path.resolve(String(outputPath === true ? path.join(projectRoot, "deploy/production.env") : outputPath));
const apply = has("apply");
const force = has("force");
const asJson = has("json");

if (!existsSync(templatePath)) throw new Error(`Template not found: ${templatePath}`);
if (existsSync(target) && !force) {
  throw new Error(`${target} already exists. Refusing to rotate secrets; pass --force only for a brand new deployment.`);
}

const template = readFileSync(templatePath, "utf8");
const generateToken = /^GENERATE:(\d+):(base64|base64url|hex)$/;
const generated = [];
let rendered = template.replace(/^([A-Z0-9_]+)=(.*)$/gm, (line, key, value) => {
  const match = generateToken.exec(value);
  if (!match) return line;
  const bytes = Number(match[1]);
  const encoding = match[2];
  if (!Number.isInteger(bytes) || bytes < 16 || bytes > 128) throw new Error(`Invalid GENERATE size for ${key}: ${value}`);
  const secret = randomBytes(bytes).toString(encoding);
  generated.push(key);
  return `${key}=${secret}`;
});

// Validate the rendered file with the same parser systemd/runtime will use.
const parsed = parseEnv(rendered);
const duplicateKeys = [];
const seen = new Set();
for (const line of rendered.split("\n")) {
  const match = /^([A-Z0-9_]+)=/.exec(line);
  if (!match) continue;
  if (seen.has(match[1])) duplicateKeys.push(match[1]);
  seen.add(match[1]);
}
if (duplicateKeys.length) throw new Error(`Duplicate keys in template: ${[...new Set(duplicateKeys)].join(", ")}`);
if (parsed.ERP_RUNTIME_MODE !== "production") throw new Error("Template must set ERP_RUNTIME_MODE=production");
if (parsed.AMAZON_API_EXECUTION_ROLE !== "cloud") throw new Error("Template must set AMAZON_API_EXECUTION_ROLE=cloud for real sync");

const unresolved = [];
for (const [key, value] of Object.entries(parsed)) {
  if (typeof value === "string" && value.startsWith("REPLACE:")) unresolved.push(key);
}
const leftoverGenerate = Object.entries(parsed).filter(([, value]) => typeof value === "string" && value.startsWith("GENERATE:")).map(([key]) => key);
if (leftoverGenerate.length) throw new Error(`Unhandled GENERATE tokens: ${leftoverGenerate.join(", ")}`);

if (apply) {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, rendered, { encoding: "utf8", mode: 0o600 });
  chmodSync(target, 0o600);
}

const summary = {
  template: templatePath,
  output: target,
  applied: apply,
  mode: parsed.ERP_RUNTIME_MODE,
  generatedKeys: generated,
  unresolvedPlaceholders: unresolved,
  permissions: apply ? "0600" : "not written",
};

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`生产 EnvironmentFile ${apply ? "已生成" : "预演（未写入）"}`);
  console.log(`  模板      ${templatePath}`);
  console.log(`  目标      ${target}${apply ? "  (0600)" : ""}`);
  console.log(`  已生成密钥 ${generated.length} 个：${generated.join(", ")}`);
  console.log(`  待填写项  ${unresolved.length} 个${unresolved.length ? `：\n    - ${unresolved.join("\n    - ")}` : ""}`);
  if (!apply) console.log("\n确认后加 --apply 写入。secret 只会写入目标文件，不会打印。");
  else console.log("\n下一步：填写 REPLACE 项，然后运行 npm run check:production -- --env <文件> --gate full");
}
