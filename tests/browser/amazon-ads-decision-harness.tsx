import { createRoot } from "react-dom/client";
import { AdsDecisionWorkbench } from "@/components/amazon-ads/decision-workbench";
createRoot(document.getElementById("root")!).render(<AdsDecisionWorkbench account="northstar" marketplace="US" />);
