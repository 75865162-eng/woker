import { createRoot } from "react-dom/client";
import { AmazonActionAudits } from "@/components/agents/amazon-action-audits";
localStorage.setItem("amazon_bulk_ad_workspace_scope", JSON.stringify({ workspaceId: "workspace-a" }));
createRoot(document.getElementById("root")!).render(<AmazonActionAudits />);
