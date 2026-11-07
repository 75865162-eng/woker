import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { SKILLS, type SkillSnapshot } from "./types";

/** Read exact requested skills. Never execute referenced scripts or fetch server replacements. */
export async function loadResearchSkills(root: string): Promise<SkillSnapshot[]> {
  const resolved = await realpath(root);
  return Promise.all(SKILLS.map(async (name) => {
    const file = await realpath(path.join(resolved, name, "SKILL.md"));
    if (!file.startsWith(resolved + path.sep)) throw new Error("SKILL_PATH_ESCAPE");
    const markdown = await readFile(file, "utf8");
    if (Buffer.byteLength(markdown) > 256_000) throw new Error("SKILL_TOO_LARGE");
    const tools = [...markdown.matchAll(/^\s*-\s+`([a-z][a-z0-9_]+)`\s*$/gm)].map((match) => match[1]);
    return { name, path: file, markdown, tools, sha256: createHash("sha256").update(markdown).digest("hex") };
  }));
}

/** Bundled originals are also available on a deployed host without a device-local Codex installation. */
export async function loadBundledResearchSkills(): Promise<SkillSnapshot[]> {
  const { skillMarkdown, findSkill } = await import("@/lib/lili/catalog");
  return Promise.all(SKILLS.map(async name => {
    const markdown = await skillMarkdown(name);
    if (!markdown) throw new Error("RESEARCH_SKILL_MISSING");
    return { name, path: `lili://skills/${name}/SKILL.md`, markdown, tools: findSkill(name)?.tools ?? [], sha256: createHash("sha256").update(markdown).digest("hex") };
  }));
}
