import "./sellfox-ui.css";
import type { ReactNode } from "react";

/* Typography is loaded for every /sellfox route and applied by .sellfox-ui
   inside the page body. The wrapper is not placed around AppShell. */
export default function SellfoxLayout({ children }: { children: ReactNode }) {
  return children;
}
