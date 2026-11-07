import { homedir } from "node:os";
import path from "node:path";
import { syncSkill } from "./skill-cache.mjs";
const endpoint=process.argv[2], skillId=process.argv[3];
if(!endpoint||!skillId) throw new Error("Usage: node scripts/lili/skill-sync.mjs https://website/api/lili/mcp skill-id [skills-root]");
const root=process.argv[4] || path.join(process.env.CODEX_HOME || path.join(homedir(),".codex"),"skills");
let id=0;
async function rpc(name,args){ const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json, text/event-stream","MCP-Protocol-Version":"2025-06-18"},body:JSON.stringify({jsonrpc:"2.0",id:++id,method:"tools/call",params:{name,arguments:args}}),redirect:"error",signal:AbortSignal.timeout(30000)}); if(!r.ok)throw new Error("MCP_HTTP_"+r.status);const p=await r.json();if(p.error||p.result?.isError)throw new Error("MCP_CALL_FAILED");return JSON.parse(p.result.content[0].text);}
console.log(JSON.stringify(await syncSkill({root,skillId,endpoint,rpc}),null,2));
