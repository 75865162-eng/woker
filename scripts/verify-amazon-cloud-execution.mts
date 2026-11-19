/**
 * 生产只读验证：确认云端执行角色已生效，配置页不会再抛 409 CLOUD_EXECUTION_REQUIRED。
 * 直接 import 真实代码 assertAmazonCloudExecution / amazonCloudExecutionEnabled，
 * 从 .env 加载与 web 进程相同的环境变量，不发起任何 Amazon 网络请求、不改数据。
 *
 * 用法（在应用发布目录）：
 *   node_modules/.bin/tsx scripts/verify-amazon-cloud-execution.mts [envFilePath]
 * 退出码：0 = 云端执行角色生效（409 已消除）；1 = 未生效。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const envPath = process.argv[2] ?? path.join(process.cwd(), ".env");
const text = readFileSync(envPath, "utf8");
for (const raw of text.split("\n")) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq < 0) continue;
  const key = line.slice(0, eq).trim();
  let value = line.slice(eq + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  if (process.env[key] === undefined) process.env[key] = value;
}

const modulePath = path.join(process.cwd(), "src/lib/amazon/execution-role.ts");
const { amazonCloudExecutionEnabled, assertAmazonCloudExecution, AmazonCloudExecutionError } = await import(
  `file://${modulePath}`
);

const enabled = amazonCloudExecutionEnabled();
let threw409 = false;
let message = "";
try {
  assertAmazonCloudExecution();
} catch (error) {
  threw409 = error instanceof AmazonCloudExecutionError;
  message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

const role = process.env.AMAZON_API_EXECUTION_ROLE ?? "(unset)";
console.log(JSON.stringify({
  amazonApiExecutionRole: role,
  amazonCloudExecutionEnabled: enabled,
  assertThrew: threw409,
  detail: message || "assertAmazonCloudExecution() 通过，未抛错",
  verdict: enabled && !threw409 ? "CLOUD_EXECUTION_OK" : "CLOUD_EXECUTION_MISSING",
}, null, 2));

process.exit(enabled && !threw409 ? 0 : 1);
