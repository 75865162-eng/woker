"use client";

import { Copy } from "lucide-react";
import type { Locale } from "@/lib/lili/tx";
import { tx } from "@/lib/lili/tx";
import { copyText, useUI } from "@/lib/lili/ui";

export function CopyButton({ text, locale }: { text: string; locale: Locale }) {
  const flash = useUI((s) => s.flash);
  return (
    <button
      className="lili-btn-orange"
      onClick={() => {
        copyText(text);
        flash(tx(locale, "已复制", "Copied"));
      }}
    >
      <Copy className="h-3.5 w-3.5" /> {tx(locale, "复制提示词", "Copy prompt")}
    </button>
  );
}
