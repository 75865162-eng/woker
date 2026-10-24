import { createRoot } from "react-dom/client";
import { AppShellUserProvider } from "@/components/app-shell/app-shell-context";
import { SellfoxWorkbench } from "@/components/sellfox/sellfox-workbench";

localStorage.setItem("amazon_bulk_ad_workspace_scope", JSON.stringify({ workspaceId: "workspace-a", marketplace: "US" }));
createRoot(document.getElementById("root")!).render(<AppShellUserProvider value={{ userRole: "owner", userInitials: "T" }}><SellfoxWorkbench /></AppShellUserProvider>);
