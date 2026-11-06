"use client";

import { useState } from "react";
import type { Locale } from "@/lib/lili/tx";
import { tx } from "@/lib/lili/tx";
import { withBasePath } from "@/lib/lili/base-path";

export function RunLiveButton({ slug, locale }: { slug: string; locale: Locale }) {
  const [text, setText] = useState("");
  const [ok, setOk] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <div className="mt-3">
      <button
        className="lili-btn-ghost"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          try {
            const res = await fetch(withBasePath("/api/workflows/pack"), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ slug, mode: "live" }),
          });
          const data = await res.json();
          setOk(res.ok);
          setText(data.message || (res.ok ? tx(locale, "真调用已返回", "Live call returned") : tx(locale, "未接通", "Not connected")));
          } catch {
            setOk(false);
            setText(tx(locale, "请求失败，请重试。", "Request failed. Please retry."));
          } finally { setPending(false); }
        }}
      >
        {pending ? "…" : tx(locale, "检查工作流执行能力", "Check workflow availability")}
      </button>
      {text && <p className={`mt-2 text-sm ${ok ? "text-emerald-700" : "text-[#9a3412]"}`}>{text}</p>}
    </div>
  );
}
