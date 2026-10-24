import { spawn } from "node:child_process";
import type { Review, Tag } from "../types";
import { PipelineError } from "../io";
export function validatePatch(value: unknown, input: Review[]): Tag[] {
  if (!Array.isArray(value) || value.length > input.length * 5) throw new PipelineError("INVALID_CLOUD_PATCH");
  return value.map(item => {
    if (!item || Object.keys(item).sort().join(",") !== "asin,quote,tag" || typeof item.asin !== "string" || typeof item.quote !== "string" || typeof item.tag !== "string" || !/^[a-z_]{1,50}$/.test(item.tag) || ["__proto__","constructor","prototype"].includes(item.tag) || !input.some(r => r.asin === item.asin && r.text === item.quote)) throw new PipelineError("UNSUPPORTED_CLOUD_QUOTE");
    return { asin: item.asin, tag: item.tag, quote: item.quote, source: "cloud" };
  });
}
// Command is a JSON argv array, never evaluated by a shell. Bounded stdin/stdout and deadline.
export async function cloudPatch(input: Review[]): Promise<Tag[]> {
  if (!input.length || !process.env.SELECTION_CLOUD_PATCH_CMD) return [];
  const argv: unknown = JSON.parse(process.env.SELECTION_CLOUD_PATCH_CMD);
  if (!Array.isArray(argv) || !argv.length || argv.some(v => typeof v !== "string")) throw new PipelineError("INVALID_CLOUD_COMMAND");
  const results: Tag[] = [];
  for (let offset = 0; offset < input.length; offset += 50) {
    const batch = input.slice(offset,offset+50);
    const stdout = await new Promise<string>((resolve,reject) => {
      const child = spawn(argv[0],argv.slice(1), { stdio: ["pipe","pipe","ignore"] });
      let output = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new PipelineError("CLOUD_TIMEOUT")); },30000);
      child.on("error", () => { clearTimeout(timer); reject(new PipelineError("CLOUD_SPAWN_FAILED")); });
      child.stdin.on("error", () => { /* Exit handler reports a failed command. */ });
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (output.length > 1024 * 1024) { child.kill("SIGKILL"); reject(new PipelineError("CLOUD_OUTPUT_TOO_LARGE")); }
      });
      child.on("close", code => { clearTimeout(timer); if (code === 0) resolve(output); else reject(new PipelineError("CLOUD_COMMAND_FAILED")); });
      child.stdin.end(JSON.stringify(batch.map(({ asin,text }) => ({ asin,quote: text }))));
    });
    results.push(...validatePatch(JSON.parse(stdout),batch));
  }
  return results;
}
