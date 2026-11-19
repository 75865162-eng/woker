import { createRoot } from "react-dom/client";
import { AppShellUserProvider } from "@/components/app-shell/app-shell-context";
import { SellfoxHub } from "@/components/sellfox/sellfox-hub";
localStorage.setItem("amazon_bulk_ad_workspace_scope", JSON.stringify({ workspaceId: "fixture-workspace", marketplace: "US" }));
createRoot(document.getElementById("root")!).render(<AppShellUserProvider value={{ userRole: "owner", userInitials: "T" }}><SellfoxHub /></AppShellUserProvider>);
