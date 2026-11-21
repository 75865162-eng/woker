import "./sellfox-ui.css";
import type { ReactNode } from "react";
import { SellfoxReferenceProvider } from "@/components/sellfox/sellfox-reference-provider";

/* Typography is loaded for every /sellfox route and applied by .sellfox-ui
   inside the page body. The wrapper is not placed around AppShell. */
export default function SellfoxLayout({ children }: { children: ReactNode }) {
  return <SellfoxReferenceProvider>{children}</SellfoxReferenceProvider>;
}
