import { createRoot } from "react-dom/client";
import { OperationsHubWorkbench } from "@/components/operations/operations-hub-workbench";

localStorage.setItem("amazon_bulk_ad_workspace_scope", JSON.stringify({ workspaceId: "workspace-a", marketplace: "US" }));
createRoot(document.getElementById("root")!).render(<OperationsHubWorkbench />);
