import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { posix } from "node:path";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const baseSha = git("rev-parse", "--verify", `${process.env.BASE_SHA}^{commit}`);
const headSha = git("rev-parse", "HEAD");
const changedPaths = git("diff", "--no-renames", "--name-only", baseSha, headSha).split("\n").filter(Boolean);
if (git("status", "--porcelain")) throw new Error("Release checkout must be clean");
const matches = (pattern) => changedPaths.some((path) => pattern.test(path));
const docsOnly = changedPaths.every((path) => /^(docs\/|specs\/|README\.md$|AGENTS\.md$|CLAUDE\.md$)/.test(path));
const prismaSchemaChanged = matches(/^prisma\/schema\.prisma$/);
const prismaMigrationChanged = matches(/^prisma\/migrations\//);
if (prismaSchemaChanged && !prismaMigrationChanged) throw new Error("Schema change requires a reviewed migration");
const lockfileChanged = matches(/^package-lock\.json$/);
const dependenciesChanged = matches(/^package(-lock)?\.json$/);
const deploymentChanged = matches(/^(\.github\/workflows\/|deploy\/|docker-compose\.yml$|scripts\/(deployment-plan\.mjs|.*release.*\.sh|.*artifact.*\.sh|bootstrap-server\.sh)$)/);
const runtimeChanged = !docsOnly;
// Compare both revisions: removing an import or renaming a dependency must
// restart its former consumer too. This runs before npm ci, using only Git/Node.
const content = new Map();
function dependencyTree(ref) {
  const tree = new Map(git("ls-tree", "-r", ref).split("\n").filter(Boolean).map(line => {
    const [metadata, path] = line.split("\t");
    return [path, metadata.split(" ")[2]];
  }));
  const read = path => {
    const blob = tree.get(path);
    if (!blob) throw new Error(`Missing tracked worker dependency: ${path}`);
    if (!content.has(blob)) content.set(blob, git("show", `${ref}:${path}`));
    return content.get(blob);
  };
  if (!tree.has("src/lib/runtime/worker-registry.json") && ref !== headSha) return new Map();
  const registrations = JSON.parse(read("src/lib/runtime/worker-registry.json"));
  const resolve = (parent, specifier) => {
    const target = specifier.startsWith("@/") ? `src/${specifier.slice(2)}` : posix.normalize(posix.join(posix.dirname(parent), specifier));
    return [target, ...[".ts", ".tsx", ".mts", ".js", ".mjs", ".json"].map(ext => `${target}${ext}`), ...[".ts", ".tsx", ".js", ".mjs"].map(ext => `${target}/index${ext}`)].find(path => tree.has(path));
  };
  const graphs = new Map();
  for (const registration of registrations) {
    const paths = new Set(), unresolved = new Set();
    const visit = path => {
      if (paths.has(path)) return;
      paths.add(path);
      const source = read(path);
      if (!/\.[cm]?[jt]sx?$/.test(path)) return;
      const specifiers = [...source.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)["']([^"'\n]+)["']/g)].filter(match => {
        if (!match[0].startsWith("from")) return true;
        const clause = source.slice(0, match.index).match(/\b(?:import|export)\s+([^;]*?)$/)?.[1].trim();
        if (!clause) return true;
        if (/^type\s/.test(clause)) return false;
        return !(/^\{[\s\S]*\}$/.test(clause) && clause.slice(1, -1).split(",").filter(part => part.trim()).every(part => /^type\s/.test(part.trim())));
      }).map(match => match[1]);
      for (const specifier of specifiers) {
        if (!specifier.startsWith(".") && !specifier.startsWith("@/")) continue;
        const dependency = resolve(path, specifier);
        if (dependency) visit(dependency); else unresolved.add(`${path}: ${specifier}`);
      }
      // worker-child selects the explicitly traversed registry entry. Other
      // non-literal imports cannot prove isolation; retain conservative restarts.
      if (path !== "scripts/runtime/worker-child.mjs" && /\b(?:import|require)\s*\(\s*[^\s"']/.test(source)) unresolved.add(path);
      if (/\b(?:import|export|from)\s*\/[*/]/.test(source)) unresolved.add(path);
    };
    for (const entry of [registration.entry, "scripts/runtime/worker-manager.mjs", "scripts/runtime/worker-child.mjs"]) visit(entry);
    graphs.set(registration.service, { paths, unresolved });
  }
  return graphs;
}
const previousWorkers = dependencyTree(baseSha), currentWorkers = dependencyTree(headSha);
const sharedWorkerChange = dependenciesChanged || prismaSchemaChanged || matches(/^(tsconfig\.json$|scripts\/runtime\/|src\/lib\/runtime\/worker-registry\.json$)/);
const workerCodeChanged = matches(/^(src\/(lib|data|workers)\/|scripts\/)/);
const workerRestartReasons = {};
function restartWorker(service) {
  const before = previousWorkers.get(service), after = currentWorkers.get(service);
  const reasons = sharedWorkerChange ? ["shared-runtime-or-dependencies"] : [];
  if (!before || !after) reasons.push("worker-registration-changed");
  for (const path of changedPaths) {
    if (before?.paths.has(path) || after?.paths.has(path) || path === `deploy/systemd/${service}.service`) reasons.push(path);
  }
  if (workerCodeChanged && (before?.unresolved.size || after?.unresolved.size)) reasons.push("unresolved-worker-dependencies");
  workerRestartReasons[service] = [...new Set(reasons)];
  return runtimeChanged && reasons.length > 0;
}
const requiresWorkerRestart = restartWorker("amazon-worker");
const requiresImageWorkerRestart = restartWorker("amazon-image-upscale-worker");
const requiresAmazonSyncWorkerRestart = restartWorker("amazon-sync-worker");
const requiresSellfoxSyncWorkerRestart = restartWorker("amazon-sellfox-sync-worker");
const workerChanged = requiresWorkerRestart || requiresImageWorkerRestart || requiresAmazonSyncWorkerRestart || requiresSellfoxSyncWorkerRestart;
const checksum = (ref) => createHash("sha256").update(execFileSync("git", ["show", `${ref}:package-lock.json`])).digest("hex");
const plan = {
  baseSha, headSha, changedPaths, releaseType: docsOnly ? "documentation" : "mixed",
  docsOnly, codeChanged: matches(/^src\//), uiChanged: matches(/^src\/(app|components)\//),
  workerChanged, dependenciesChanged, lockfileChanged, prismaSchemaChanged, prismaMigrationChanged,
  deploymentChanged, applicationReleaseRequired: runtimeChanged, requiresBuild: runtimeChanged,
  requiresInstall: lockfileChanged, requiresMigration: prismaMigrationChanged,
  requiresPrismaGenerate: prismaSchemaChanged || prismaMigrationChanged || lockfileChanged,
  requiresWebRestart: runtimeChanged,
  requiresWorkerRestart, requiresImageWorkerRestart, requiresAmazonSyncWorkerRestart, requiresSellfoxSyncWorkerRestart,
  workerRestartReasons,
  requiresRuntimeConfig: matches(/^deploy\/systemd\//),
  requiresCaddyReload: matches(/^deploy\/caddy\//),
  requiresInfraUpdate: matches(/^docker-compose\.yml$/),
  requiresDeploy: runtimeChanged, requiresManualDeploymentReview: deploymentChanged || prismaMigrationChanged,
  previousLockfileSha256: checksum(baseSha), lockfileSha256: checksum(headSha),
};
mkdirSync("dist", { recursive: true });
writeFileSync("dist/deployment-plan.json", `${JSON.stringify(plan, null, 2)}\n`);
if (process.env.GITHUB_OUTPUT) {
  writeFileSync(process.env.GITHUB_OUTPUT, `release=${runtimeChanged}\nmanual_review=${plan.requiresManualDeploymentReview}\n`, { flag: "a" });
}
console.log(JSON.stringify(plan, null, 2));
