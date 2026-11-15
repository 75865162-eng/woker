/**
 * Rotate the bootstrap owner password without re-running the full seed.
 *
 *   npm run prod:rotate-password -- --env-file /etc/tiaotiao/erp.env --generate --apply --update-env
 *   npm run prod:rotate-password -- --env-file /etc/tiaotiao/erp.env --apply --update-env   # dry-run unless --apply
 *
 * Safety:
 *  - Dry-run by default; --apply is required for any mutation.
 *  - Uses the exact scrypt:${salt}:${hash} format consumed by verifyPassword().
 *  - Deletes the owner's existing UserSession rows so old cookies stop working.
 *  - Writes an AuditLog entry. Never logs the password hash.
 *  - Refuses weak passwords, and refuses to edit a production EnvironmentFile
 *    unless --update-env is given explicitly.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes, scryptSync } from "node:crypto";
import { parseEnv } from "node:util";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { applyRuntimeEnvironment } from "./environment.mjs";

const args = process.argv.slice(2);
const flag = name => {
  const idx = args.indexOf(`--${name}`);
  return idx < 0 ? undefined : (args[idx + 1] && !args[idx + 1].startsWith("--") ? args[idx + 1] : true);
};
const has = name => args.includes(`--${name}`);

const envFilePath = flag("env-file");
const envPath = envFilePath ? path.resolve(String(envFilePath)) : null;
if (envPath && !existsSync(envPath)) throw new Error(`EnvironmentFile not found: ${envPath}`);

// With --env-file we deliberately bypass applyRuntimeEnvironment(): a production
// EnvironmentFile is injected by systemd and must not be mixed with local .env.
const env = envPath
  ? { ...process.env, ...parseEnv(readFileSync(envPath, "utf8")) }
  : applyRuntimeEnvironment({ validation: "database" });

const connectionString = env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
const adminEmail = String(env.BOOTSTRAP_ADMIN_EMAIL ?? "").trim().toLowerCase();
if (!adminEmail) throw new Error("BOOTSTRAP_ADMIN_EMAIL is required.");
const mode = env.ERP_RUNTIME_MODE ?? "local";

let password;
if (has("password-stdin")) {
  password = readFileSync(0, "utf8").trim();
} else if (typeof flag("password") === "string") {
  password = String(flag("password"));
} else {
  password = randomBytes(24).toString("base64url");
}
const weak = new Set(["123", "admin", "password", "123456", "admin123", "test", "test1234", "replace-with-a-strong-password"]);
if (password.length < 12 || weak.has(password.toLowerCase())) {
  throw new Error("Refusing weak password: require >= 12 characters and no common/default value.");
}

function hashPassword(value) {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(value, salt, 64).toString("base64url");
  return `scrypt:${salt}:${hash}`;
}

const apply = has("apply");
const updateEnv = has("update-env");
if (updateEnv && !envPath) throw new Error("--update-env requires --env-file.");
if (updateEnv && !apply) throw new Error("--update-env has no effect in dry-run; add --apply.");

const dbHost = (() => { try { return new URL(connectionString).hostname; } catch { return "(invalid URL)"; } })();
console.log(`口令轮换 ${apply ? "[APPLY]" : "[DRY-RUN]"}`);
console.log(`  模式        ${mode}`);
console.log(`  账号        ${adminEmail}`);
console.log(`  数据库      ${dbHost}`);
console.log(`  新口令长度  ${password.length}（${has("password") || has("password-stdin") ? "操作员提供" : "随机生成"}）`);
console.log(`  更新环境文件 ${updateEnv ? envPath : "否"}`);
console.log(`  吊销会话    ${apply ? "是" : "否（预演）"}`);

if (!apply) {
  console.log("\n未做任何修改。确认后加 --apply。");
  process.exit(0);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
try {
  const user = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!user) throw new Error(`Bootstrap owner ${adminEmail} does not exist. Run npm run db:seed-admin first.`);

  await prisma.$transaction(async tx => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(password), status: "active" } });
    const sessions = await tx.userSession.deleteMany({ where: { userId: user.id } });
    const membership = await tx.organizationMember.findFirst({ where: { userId: user.id, role: "owner" }, select: { organizationId: true } });
    await tx.auditLog.create({
      data: {
        organizationId: membership?.organizationId ?? null,
        userId: user.id,
        action: "bootstrap_admin_password_rotated",
        entityType: "User",
        entityId: user.id,
      },
    });
    console.log(`  已吊销会话  ${sessions.count} 条`);
  });

  if (updateEnv) {
    const original = readFileSync(envPath, "utf8");
    const lines = original.split("\n");
    let replaced = 0;
    const updated = lines.map(line => {
      if (!/^BOOTSTRAP_ADMIN_PASSWORD=/.test(line)) return line;
      replaced += 1;
      return `BOOTSTRAP_ADMIN_PASSWORD=${password}`;
    });
    if (replaced !== 1) throw new Error(`Expected exactly one BOOTSTRAP_ADMIN_PASSWORD in ${envPath}, found ${replaced}.`);
    writeFileSync(envPath, updated.join("\n"), { encoding: "utf8", mode: 0o600 });
    console.log(`  已写入      ${envPath}`);
  }

  console.log(`\n新口令（仅显示一次，请立即存入密码管理器）：\n${password}`);
  console.log("\n请重新登录验证，并确认旧的会话 Cookie 已失效。");
} finally {
  await prisma.$disconnect();
}
