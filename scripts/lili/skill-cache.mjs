import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, lstat, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
export const digest = text => createHash("sha256").update(text, "utf8").digest("hex");
/** No scripts are executed; original user Skills with differing content are preserved. */
export async function syncSkill({ root, skillId, endpoint, rpc }) {
 if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(skillId)) throw new Error("INVALID_SKILL_ID");
 const source = new URL(endpoint);
 if (source.username || source.password || source.search || source.hash || source.pathname !== "/api/lili/mcp") throw new Error("INVALID_SOURCE");
 if (source.protocol !== "https:" && !(source.protocol === "http:" && ["localhost","127.0.0.1","[::1]"].includes(source.hostname))) throw new Error("HTTPS_REQUIRED");
 const { manifest } = await rpc("meta_get_skill_manifest", { skill_id: skillId });
 if (manifest?.min_lili_version && manifest.min_lili_version.split(".").some((part,index,parts) => Number(part) > Number(["1","4","0"][index]) && parts.slice(0,index).every((p,i)=>Number(p)===Number(["1","4","0"][i])))) throw new Error("LILI_CLIENT_VERSION_TOO_OLD");
 if (manifest?.skill_id !== skillId || !/^[a-f0-9]{64}$/.test(manifest.sha256) || manifest.version !== "sha256:" + manifest.sha256 || manifest.source !== "lili://skills/" + skillId + "/SKILL.md") throw new Error("INVALID_MANIFEST");
 await mkdir(root, { recursive:true });
 const base = await realpath(root);
 async function local(folder) {
  try { const stat = await lstat(folder); if (stat.isSymbolicLink()) throw new Error("SYMLINK_REFUSED"); const resolved = await realpath(folder); if (path.dirname(resolved)!==base) throw new Error("PATH_ESCAPE"); const file = path.join(resolved,"SKILL.md"); if ((await lstat(file)).isSymbolicLink()) throw new Error("SYMLINK_REFUSED"); const markdown = await readFile(file,"utf8"); return { markdown, sha256:digest(markdown) }; } catch(e) { if(e.code === "ENOENT") return null; throw e; }
 }
 const originalDir = path.join(base,skillId), original = await local(originalDir);
 if (original?.sha256 === manifest.sha256) return { status:"local-hit", path:path.join(originalDir,"SKILL.md"), manifest };
 const target = path.join(base,"lili-"+skillId), cached = await local(target);
 if (cached) {
  let prior; try { prior=JSON.parse(await readFile(path.join(target,".lili-manifest.json"),"utf8")); }catch { throw new Error("USER_SKILL_CONFLICT"); }
  if(prior.endpoint!==source.href || prior.manifest?.sha256!==cached.sha256) throw new Error("USER_SKILL_CONFLICT");
  if (cached.sha256 === manifest.sha256) return { status:"local-hit", path:path.join(target,"SKILL.md"), manifest };
 }
 const loaded = await rpc("meta_load_skill", {skill_name:skillId});
 if(typeof loaded.markdown!=="string" || Buffer.byteLength(loaded.markdown)>256000 || digest(loaded.markdown)!==manifest.sha256 || loaded.manifest?.sha256!==manifest.sha256) throw new Error("SKILL_HASH_MISMATCH");
 await mkdir(target,{recursive:true});
 if ((await lstat(target)).isSymbolicLink() || path.dirname(await realpath(target))!==base) throw new Error("PATH_ESCAPE");
 const suffix=".tmp-"+randomUUID(), file=path.join(target,"SKILL.md");
 try { await writeFile(file+suffix,loaded.markdown,{flag:"wx",mode:0o600}); await rename(file+suffix,file); await writeFile(path.join(target,".lili-manifest.json"),JSON.stringify({endpoint:source.href,manifest,installedAt:new Date().toISOString()},null,2),{mode:0o600}); } finally { await unlink(file+suffix).catch(()=>{}); }
 return {status:cached?"updated":"downloaded",path:file,manifest};
}
