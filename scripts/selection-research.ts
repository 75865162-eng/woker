import path from "node:path";
import { homedir, userInfo } from "node:os";
import { LocalResearchStore } from "../src/lib/selection-research/file-store";
import { researchFixture } from "../src/lib/selection-research/fixture";
import { ResearchEngine } from "../src/lib/selection-research/engine";
import { loadResearchSkills } from "../src/lib/selection-research/skills";
import { renderResearchReport } from "../src/lib/selection-research/report";
import type { Decision } from "../src/lib/selection-research/types";

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--") || !argv[i + 1]) throw new Error("EXPECTED_FLAG_VALUE_PAIRS");
    flags[argv[i].slice(2)] = argv[i + 1];
  }
  if (!flags.root) throw new Error("EXPLICIT_PRIVATE_ROOT_REQUIRED");
  const store = new LocalResearchStore(path.resolve(flags.root));
  const fixture = researchFixture();
  const engine = new ResearchEngine(store, { organizationId: "local-fixture", workspaceId: "local-fixture", ownerId: `os-uid-${userInfo().uid}` }, fixture.transport, fixture.agent, { mode: "fixture" });
  if (command === "create") {
    const skills = await loadResearchSkills(flags.skills || path.join(homedir(), ".codex", "skills"));
    console.log(JSON.stringify(await engine.create({ requirement: flags.requirement || "", marketplace: flags.marketplace || "US", skills, policies: fixture.policies, limits: {} }), null, 2));
    return;
  }
  if (!flags.id) throw new Error("RUN_ID_REQUIRED");
  if (command === "show") console.log(JSON.stringify(await engine.inspect(flags.id), null, 2));
  else if (command === "context") console.log(JSON.stringify(await engine.getContext(flags.id), null, 2));
  else if (command === "step") console.log(JSON.stringify(await engine.step(flags.id), null, 2));
  else if (command === "drive") {
    let run = await engine.inspect(flags.id);
    for (let i = 0; i < 30 && ["CREATED", "RESUMABLE", "RUNNING"].includes(run.status); i++) run = await engine.step(flags.id);
    console.log(JSON.stringify(run, null, 2));
  } else if (command === "decide") console.log(JSON.stringify(await engine.decide(flags.id, JSON.parse(flags.decision) as Decision), null, 2));
  else if (command === "recover") console.log(JSON.stringify(await engine.recover(flags.id), null, 2));
  else if (command === "recover-lock") { await store.recoverDeadProcessLock(flags.id); console.log("Dead local process lock recovered; uncertain calls will not be replayed."); }
  else if (command === "cancel") console.log(JSON.stringify(await engine.cancel(flags.id), null, 2));
  else if (command === "report") console.log(renderResearchReport(await engine.inspect(flags.id)));
  else throw new Error("UNKNOWN_COMMAND");
}
main().catch(() => { console.error("Selection command failed. Check command, scope, gate and private store; no credentials or raw exception text are printed."); process.exitCode = 1; });
