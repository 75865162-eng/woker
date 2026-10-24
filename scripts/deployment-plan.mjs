import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const baseSha = git("rev-parse", "--verify", `${process.env.BASE_SHA}^{commit}`);
const headSha = git("rev-parse", "HEAD");
const changedPaths = git("diff", "--name-only", baseSha, headSha).split("\n").filter(Boolean);
if (git("status", "--porcelain")) throw new Error("Release checkout must be clean");
const matches = (pattern) => changedPaths.some((path) => pattern.test(path));
const docsOnly = changedPaths.every((path) => /^(docs\/|specs\/|README\.md$|AGENTS\.md$|CLAUDE\.md$)/.test(path));
const prismaSchemaChanged = matches(/^prisma\/schema\.prisma$/);
const prismaMigrationChanged = matches(/^prisma\/migrations\//);
if (prismaSchemaChanged && !prismaMigrationChanged) throw new Error("Schema change requires a reviewed migration");
const lockfileChanged = matches(/^package-lock\.json$/);
const dependenciesChanged = matches(/^package(-lock)?\.json$/);
const deploymentChanged = matches(/^(\.github\/workflows\/|deploy\/|docker-compose\.yml$|scripts\/(deployment-plan\.mjs|.*release.*\.sh|.*artifact.*\.sh|bootstrap-server\.sh)$)/);
const sharedChanged = matches(/^src\/lib\//);
const workerChanged = matches(/^(src\/workers\/|scripts\/import-worker\.ts$)/);
const imageWorkerChanged = matches(/^scripts\/image-upscale-worker\.ts$/);
const amazonSyncWorkerChanged = matches(/^scripts\/amazon-sync-worker\.ts$/);
const sellfoxSyncWorkerChanged = matches(/^scripts\/sellfox-sync-worker\.ts$/);
// Shared library dependency analysis is conservative: both workers consume src/lib.
const runtimeChanged = !docsOnly;
const checksum = (ref) => createHash("sha256").update(execFileSync("git", ["show", `${ref}:package-lock.json`])).digest("hex");
const plan = {
  baseSha, headSha, changedPaths, releaseType: docsOnly ? "documentation" : "mixed",
  docsOnly, codeChanged: matches(/^src\//), uiChanged: matches(/^src\/(app|components)\//),
  workerChanged, dependenciesChanged, lockfileChanged, prismaSchemaChanged, prismaMigrationChanged,
  deploymentChanged, applicationReleaseRequired: runtimeChanged, requiresBuild: runtimeChanged,
  requiresInstall: lockfileChanged, requiresMigration: prismaMigrationChanged,
  requiresPrismaGenerate: prismaSchemaChanged || prismaMigrationChanged || lockfileChanged,
  requiresWebRestart: runtimeChanged,
  requiresWorkerRestart: workerChanged || sharedChanged || lockfileChanged || prismaSchemaChanged || prismaMigrationChanged || matches(/^deploy\/systemd\/amazon-worker\.service$/),
  requiresImageWorkerRestart: imageWorkerChanged || sharedChanged || lockfileChanged || prismaSchemaChanged || prismaMigrationChanged || matches(/^deploy\/systemd\/amazon-image-upscale-worker\.service$/),
  requiresAmazonSyncWorkerRestart: amazonSyncWorkerChanged || sharedChanged || lockfileChanged || prismaSchemaChanged || prismaMigrationChanged || matches(/^deploy\/systemd\/amazon-sync-worker\.service$/),
  requiresSellfoxSyncWorkerRestart: sellfoxSyncWorkerChanged || sharedChanged || lockfileChanged || prismaSchemaChanged || prismaMigrationChanged || matches(/^deploy\/systemd\/amazon-sellfox-sync-worker\.service$/),
  requiresRuntimeConfig: matches(/^deploy\/systemd\//),
  requiresCaddyReload: matches(/^deploy\/caddy\//),
  requiresInfraUpdate: matches(/^docker-compose\.yml$/),
  requiresDeploy: runtimeChanged, requiresManualDeploymentReview: deploymentChanged || prismaMigrationChanged,
  previousLockfileSha256: checksum(baseSha), lockfileSha256: checksum(headSha),
};
mkdirSync("dist", { recursive: true });
writeFileSync("dist/deployment-plan.json", `${JSON.stringify(plan, null, 2)}\n`);
if (process.env.GITHUB_OUTPUT) {
  writeFileSync(process.env.GITHUB_OUTPUT, `release=${runtimeChanged}\nmanual_review=${deploymentChanged}\n`, { flag: "a" });
}
console.log(JSON.stringify(plan, null, 2));
