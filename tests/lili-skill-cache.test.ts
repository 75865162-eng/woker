import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getSkillManifest } from "@/lib/lili/skill-manifest";
import { skillMarkdown } from "@/lib/lili/catalog";
// Client-only code is intentionally ordinary Node; it never executes Skill code.
test("local cache verifies exact originals, skips downloads on hits, preserves user content and refuses tampering", async () => {
 const { syncSkill } = await import("../scripts/lili/skill-cache.mjs");
 const root = await mkdtemp(path.join(tmpdir(), "lili-cache-fixture-"));
 const skillId = "amazon-niche-finder", manifest = await getSkillManifest(skillId), markdown = (await skillMarkdown(skillId))!;
 let loads = 0;
 const rpc = async (name: string) => { if (name === "meta_get_skill_manifest") return { manifest }; loads++; return { manifest, markdown }; };
 try {
  await mkdir(path.join(root,skillId)); await writeFile(path.join(root,skillId,"SKILL.md"),markdown);
  assert.equal((await syncSkill({root,skillId,endpoint:"https://lili.example/api/lili/mcp",rpc})).status,"local-hit"); assert.equal(loads,0);
  await writeFile(path.join(root,skillId,"SKILL.md"),"original user procedure");
  const installed = await syncSkill({root,skillId,endpoint:"https://lili.example/api/lili/mcp",rpc}); assert.equal(installed.status,"downloaded"); assert.equal(loads,1);
  assert.equal(await readFile(path.join(root,skillId,"SKILL.md"),"utf8"),"original user procedure");
  assert.equal((await syncSkill({root,skillId,endpoint:"https://lili.example/api/lili/mcp",rpc})).status,"local-hit"); assert.equal(loads,1);
  await writeFile(installed.path,"user edited cached procedure");
  await assert.rejects(syncSkill({root,skillId,endpoint:"https://lili.example/api/lili/mcp",rpc}),/USER_SKILL_CONFLICT/);
  await assert.rejects(syncSkill({root,skillId:"../../private",endpoint:"https://lili.example/api/lili/mcp",rpc}),/INVALID_SKILL_ID/);
  await assert.rejects(syncSkill({root,skillId,endpoint:"http://untrusted.example/api/lili/mcp",rpc}),/HTTPS_REQUIRED/);
  const fresh = path.join(root,"fresh");
  await assert.rejects(syncSkill({root:fresh,skillId,endpoint:"https://lili.example/api/lili/mcp",rpc:async(name:string)=>name==="meta_get_skill_manifest"?{manifest}:{manifest,markdown:markdown+"tamper"}}),/SKILL_HASH_MISMATCH/);
  const unsafe = path.join(root,"unsafe");await mkdir(unsafe); await symlink(path.join(root,skillId),path.join(unsafe,skillId));
  await assert.rejects(syncSkill({root:unsafe,skillId,endpoint:"https://lili.example/api/lili/mcp",rpc}),/SYMLINK_REFUSED/);
 } finally { await rm(root,{recursive:true,force:true}); }
});

test("managed cache checks its website source even when the content hash is identical", async () => {
 const { syncSkill } = await import("../scripts/lili/skill-cache.mjs");
 const root = await mkdtemp(path.join(tmpdir(), "lili-source-fixture-"));
 const skillId = "amazon-niche-finder", manifest = await getSkillManifest(skillId), markdown = (await skillMarkdown(skillId))!;
 const rpc = async (name: string) => name === "meta_get_skill_manifest" ? { manifest } : { manifest, markdown };
 try {
  await syncSkill({ root, skillId, endpoint: "https://first.example/api/lili/mcp", rpc });
  await assert.rejects(syncSkill({ root, skillId, endpoint: "https://second.example/api/lili/mcp", rpc }), /USER_SKILL_CONFLICT/);
 } finally { await rm(root, { recursive: true, force: true }); }
});
