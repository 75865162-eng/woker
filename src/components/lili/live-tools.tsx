"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { RuntimeTool, ProviderStatus } from "@/lib/lili/runtime-tools";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";

export function LiveTools() {
  const [tools, setTools] = useState<RuntimeTool[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [selected, setSelected] = useState("");
  const [input, setInput] = useState("{}");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const changed = () => { generation.current++; setTools([]); setProviders([]); setSelected(""); setInput("{}"); setResult(""); };
    window.addEventListener(workspaceScopeChangedEventName, changed);
    return () => window.removeEventListener(workspaceScopeChangedEventName, changed);
  }, []);
  const tool = tools.find(tool => tool.name === selected);
  return <section className="lili-card mb-5 space-y-3 p-4">
    <h2 className="font-semibold">真实 MCP 工具</h2>
    <p className="text-sm text-muted">读取当前工作区真实注册表、Schema 与权限。外部市场请求进入选品研究审批；此处可调用已授权 ERP 只读工具。</p>
    <button className="lili-btn-orange" disabled={busy} onClick={async () => {
      const current = generation.current;
      setBusy(true); setResult("");
      try {
        const response = await fetch("/api/lili/mcp", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error("在线目录读取失败，请检查登录与授权。");
        if (current !== generation.current) return;
        setTools(data.tools); setProviders(data.providers); setSelected("");
      } catch { if (current === generation.current) setResult("在线目录读取失败，请检查登录与授权。"); }
      finally { setBusy(false); }
    }}>发现真实工具</button>
    {providers.map(provider => <p className="text-sm" key={provider.provider}>{provider.provider}：{provider.status} · {provider.toolCount} 个工具 {provider.reason}</p>)}
    {tools.length > 0 && <label className="block text-sm">选择在线工具<select aria-label="选择在线工具" className="lili-field ml-3" value={selected} onChange={event => { setSelected(event.target.value); setInput("{}"); setResult(""); }}>
      <option value="">请选择</option>{tools.map(tool => <option key={tool.name} value={tool.name}>{tool.name} · {tool.permission} · {tool.availability}</option>)}
    </select></label>}
    {tool && <div className="space-y-3">
      <p className="text-sm">{tool.description}</p>
      <details><summary>真实参数 Schema</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(tool.inputSchema, null, 2)}</pre></details>
      <label className="block text-sm">工具参数 JSON<textarea aria-label="工具参数 JSON" className="lili-field block min-h-24 w-full font-mono" value={input} onChange={event => setInput(event.target.value)} /></label>
      <button className="lili-btn-orange" disabled={busy || tool.availability !== "available" || !["erp", "skills"].includes(tool.provider)} onClick={async () => {
        const current = generation.current;
        setBusy(true);
        try {
          const args = JSON.parse(input);
          const response = await fetch("/api/lili/tools/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: tool.name, input: args }) });
          const data = await response.json();
          if (current === generation.current) setResult(JSON.stringify(data, null, 2));
        } catch { if (current === generation.current) setResult("调用失败，请检查 JSON 参数及当前工具授权。"); }
        finally { setBusy(false); }
      }}>执行授权只读查询</button>
    </div>}
    {result && <pre role="status" className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{result}</pre>}
    <Link className="block text-sm underline" href="/agents/selection-research">进入 ASIN 选品研究、人工审批与历史报告</Link>
  </section>;
}
