"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import { liliClientConnection } from "@/lib/lili/client-connection";
type Device = { id: string; name: string; status: string; expiresAt: string; lastUsedAt: string | null };
export function LiliDevicesPanel() {
 const [connection, setConnection] = useState<ReturnType<typeof liliClientConnection> | null>(null);
 const [connectionError, setConnectionError] = useState(""), [copied, setCopied] = useState("");
 useEffect(() => {
  try { setConnection(liliClientConnection(window.location.origin)); }
  catch(e) { setConnectionError(e instanceof Error ? e.message : "无法生成连接地址。"); }
 }, []);
 async function copy(label: string, value: string) {
  try { await navigator.clipboard.writeText(value); setCopied(`已复制${label}`); }
  catch { setCopied("自动复制失败，请手动选择并复制文本。"); }
 }
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
 <p className="text-xs text-muted">这是 ERP 对外提供的 MCP 接口：AI 调用端通过 Lili 工具读取授权范围内的 Amazon 数据。服务器部署负责接口常驻；AI 调用端仍须注册此 MCP、完成授权并发现工具。本机 Codex 的配置不会自动同步到其他 AI 调用端。</p>
 <p className="text-xs text-muted">Lili MCP 可供支持远程 MCP 的 AI 客户端连接。网站服务可用、客户端已连接、当前聊天已加载工具是三个不同状态；本页面不能读取当前聊天的工具列表。</p>
 {connectionError && <p role="alert" className="text-sm text-red-600">{connectionError}</p>}
 {connection && <div className="space-y-3 rounded border border-border p-3">
  <label className="block text-xs">Lili MCP 连接地址<input aria-label="Lili MCP 连接地址" readOnly className="mt-1 block w-full rounded border p-2 font-mono" value={connection.endpoint}/></label>
  <button type="button" className="text-xs underline" onClick={()=>void copy("连接地址",connection.endpoint)}>复制连接地址</button>
  <details><summary className="cursor-pointer text-sm">Codex 配置与连接步骤</summary><div className="mt-2 space-y-2 text-xs">
   <p>1. 在 Codex MCP 设置中添加名为 lili 的远程服务，使用上方地址；已有同名服务时核对地址。也可将下方内容合并到 ~/.codex/config.toml，保留其他服务配置，避免重复添加同名段。</p>
   <pre className="overflow-x-auto rounded border p-2">{connection.toml}</pre>
   <button type="button" className="underline" onClick={()=>void copy("Codex 配置",connection.toml)}>复制 Codex 配置</button>
   <p>2. 选择下方已有个人凭证，生成一次性验证密钥。终端运行下方命令，在授权页输入配对 ID 和密钥。</p>
   <pre className="overflow-x-auto rounded border p-2">{connection.loginCommand}</pre>
   <button type="button" className="underline" onClick={()=>void copy("登录命令",connection.loginCommand)}>复制登录命令</button>
   <p>3. 客户端重新加载 MCP 或重启后新建聊天，再发送下方验收指令。配置保存或网页目录可访问，都不代表当前聊天已经接入。</p>
   <p className="rounded border p-2">{connection.verifyPrompt}</p>
   <button type="button" className="underline" onClick={()=>void copy("验收指令",connection.verifyPrompt)}>复制验收指令</button>
  </div></details>
  <details><summary className="cursor-pointer text-sm">提示“本会话没有暴露 lili MCP 工具”怎么办</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted">
   <li>先确认上方地址对应的网站正在运行。本机 localhost 服务停止后，客户端无法连接；不要改成其他网站地址来绕过。</li>
   <li>在 Codex MCP 设置中核对 lili 已启用、地址一致；需要授权时运行 codex mcp login lili。</li>
   <li>重新加载 MCP 或完全重启客户端后新建聊天，检查真实工具列表和 lili_ping 的 authenticated 状态。</li>
   <li>其他 MCP（例如 duobaoyu）可用不代表 lili 已接通。不要把 Token、含密钥的连接链接或配对密钥发到聊天。</li>
  </ul></details>
 </div>}
 {copied && <p role="status" className="text-xs text-muted">{copied}</p>}
 <p className="text-xs text-muted">Codex 配置 Lili 入口后运行 codex mcp login lili。在授权页输入下方配对 ID 和验证密钥，完成一次授权；不要把密钥发到聊天。</p>
 <p className="text-xs text-muted">入口：/api/lili/mcp。支持 OAuth S256 PKCE、1 小时访问令牌与刷新轮换；设备有效期受原凭证和 30 天上限约束。旧 Bearer 配对助手仍可使用。配对继承选中凭证范围，不能扩大授权。</p>
 {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
 <label className="block text-sm">个人凭证<select aria-label="配对个人凭证" className="ml-2 rounded border p-2" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">选择已有授权</option>{credentials.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
 <button disabled={busy||!selected} className="rounded border px-3 py-2 text-sm disabled:opacity-50" onClick={()=>void act({action:"pair",credentialId:selected})}>生成一次性验证密钥</button>
 {pair && <div className="space-y-2 rounded border border-amber-400 p-3"><p className="text-sm">仅本次展示，有效期至 {new Date(pair.expiresAt).toLocaleString()}；请在本机连接助手输入，勿发送到聊天。</p><label className="block text-xs">配对 ID<input readOnly className="block w-full border p-2 font-mono" value={pair.pairingId}/></label><label className="block text-xs">验证密钥<input aria-label="Lili 一次性验证密钥" readOnly className="block w-full border p-2 font-mono" value={pair.code}/></label><button onClick={()=>setPair(null)} className="text-sm underline">已保存，关闭展示</button></div>}
 <ul className="space-y-2">{devices.map(d=><li key={d.id} className="border-t pt-2 text-xs">{d.name} · {d.status} · 到期 {new Date(d.expiresAt).toLocaleString()} · 最近连接 {d.lastUsedAt?new Date(d.lastUsedAt).toLocaleString():"尚未连接"}<button disabled={busy||d.status==="REVOKED"} className="ml-3 underline" onClick={()=>void act({action:"revoke",id:d.id})}>撤销</button></li>)}</ul>
 </section>;
}
