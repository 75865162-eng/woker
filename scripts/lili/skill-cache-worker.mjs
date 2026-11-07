// Local-only worker: parent forwards RPC through the installed Codex native client.
import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import { syncSkill, digest } from "./skill-cache.mjs";
const input = createInterface({ input: process.stdin });
const lines = input[Symbol.asyncIterator]();
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
try {
 const config = JSON.parse((await lines.next()).value);
 const rpc = async (name, args) => {
  send({ type: "rpc", name, arguments: args });
  const next = await lines.next();
  if (next.done) throw new Error("NATIVE_CLIENT_CLOSED");
  const result = JSON.parse(next.value);
  if (result.error) throw new Error("NATIVE_TOOL_FAILED");
  return result.result;
 };
 const installed = await syncSkill({ root: config.root, endpoint: config.endpoint, skillId: config.skillId, rpc });
 const markdown = await readFile(installed.path, "utf8");
 if (digest(markdown) !== installed.manifest.sha256) throw new Error("SKILL_CHANGED_DURING_LOAD");
 send({ type: "result", ...installed, loaded: true, markdown });
} catch {
 send({ type: "error", code: "SKILL_SYNC_OR_VERIFICATION_FAILED" });
 process.exitCode = 1;
} finally { input.close(); }
