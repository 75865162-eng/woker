"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
type Device = { id: string; name: string; status: string; expiresAt: string; lastUsedAt: string | null };
export function LiliDevicesPanel() {
 const [devices, setDevices] = useState<Device[]>([]), [credentials, setCredentials] = useState<Device[]>([]), [selected, setSelected] = useState("");
 const [pair, setPair] = useState<{pairingId: string; code: string; expiresAt: string} | null>(null), [error,setError] = useState(""), [busy,setBusy] = useState(false);
 const sequence = useRef(0);
 const invalidate = useCallback(() => { sequence.current++; }, []);
 function headers() { const h = new Headers({"content-type":"application/json"}); try { h.set("x-workspace-id", JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") || "{}").workspaceId || "default"); } catch { h.set("x-workspace-id","default"); } return h; }
 const load = useCallback(async () => {
  const ticket = ++sequence.current; setError("");
  try {
   const [a,b] = await Promise.all([fetch("/api/lili/devices",{headers:headers(),cache:"no-store"}),fetch("/api/operations/amazon-mcp",{headers:headers(),cache:"no-store"})]);
   if (!a.ok || !b.ok) throw new Error("设备或个人凭证读取失败。");
   const devices = (await a.json()).devices, credentials = (await b.json()).credentials;
   if (ticket === sequence.current) { setDevices(devices); setCredentials(credentials.filter((c:Device) => c.status === "ACTIVE" && new Date(c.expiresAt).getTime() > Date.now())); }
  } catch(e) { if (ticket === sequence.current) { setDevices([]); setCredentials([]); setError(e instanceof Error ? e.message : "读取失败。"); } }
 }, []);
 useEffect(() => { void load(); const changed = () => { setPair(null); setSelected(""); setDevices([]); setCredentials([]); void load(); }; window.addEventListener(workspaceScopeChangedEventName, changed); return () => { invalidate(); window.removeEventListener(workspaceScopeChangedEventName, changed); }; }, [load, invalidate]);
 async function act(body: object) { setBusy(true);setError("");try { const ticket = sequence.current; const r = await fetch("/api/lili/devices",{method:"POST",headers:headers(),body:JSON.stringify(body)});const p=await r.json();if(!r.ok)throw new Error(p.error);if(ticket !== sequence.current)return;if(p.code)setPair(p);else if(pair && "id" in body && body.id === pair.pairingId)setPair(null);await load(); }catch(e){setError(e instanceof Error?e.message:"操作失败。");}finally{setBusy(false);} }
 return <section className="space-y-3 rounded border border-border p-4"><h2 className="text-sm font-semibold">AI 与 MCP → Lili MCP → 连接 Codex</h2>
 <p className="text-xs text-muted">Codex 配置 Lili 入口后运行 codex mcp login lili。在授权页输入下方配对 ID 和验证密钥，完成一次授权；不要把密钥发到聊天。</p>
 <p className="text-xs text-muted">入口：/api/lili/mcp。支持 OAuth S256 PKCE、1 小时访问令牌与刷新轮换；设备有效期受原凭证和 30 天上限约束。旧 Bearer 配对助手仍可使用。配对继承选中凭证范围，不能扩大授权。</p>
 {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
 <label className="block text-sm">个人凭证<select aria-label="配对个人凭证" className="ml-2 rounded border p-2" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">选择已有授权</option>{credentials.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
 <button disabled={busy||!selected} className="rounded border px-3 py-2 text-sm disabled:opacity-50" onClick={()=>void act({action:"pair",credentialId:selected})}>生成一次性验证密钥</button>
 {pair && <div className="space-y-2 rounded border border-amber-400 p-3"><p className="text-sm">仅本次展示，有效期至 {new Date(pair.expiresAt).toLocaleString()}；请在本机连接助手输入，勿发送到聊天。</p><label className="block text-xs">配对 ID<input readOnly className="block w-full border p-2 font-mono" value={pair.pairingId}/></label><label className="block text-xs">验证密钥<input aria-label="Lili 一次性验证密钥" readOnly className="block w-full border p-2 font-mono" value={pair.code}/></label><button onClick={()=>setPair(null)} className="text-sm underline">已保存，关闭展示</button></div>}
 <ul className="space-y-2">{devices.map(d=><li key={d.id} className="border-t pt-2 text-xs">{d.name} · {d.status} · 到期 {new Date(d.expiresAt).toLocaleString()} · 最近连接 {d.lastUsedAt?new Date(d.lastUsedAt).toLocaleString():"尚未连接"}<button disabled={busy||d.status==="REVOKED"} className="ml-3 underline" onClick={()=>void act({action:"revoke",id:d.id})}>撤销</button></li>)}</ul>
 </section>;
}
