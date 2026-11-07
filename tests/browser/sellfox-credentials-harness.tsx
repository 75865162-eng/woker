import { createRoot } from "react-dom/client";
import { AppShellUserProvider } from "@/components/app-shell/app-shell-context";
import { SellfoxCredentialsPanel } from "@/components/settings/sellfox-credentials-panel";

localStorage.setItem("amazon_bulk_ad_workspace_scope", JSON.stringify({ workspaceId: "workspace-a" }));
createRoot(document.getElementById("root")!).render(<AppShellUserProvider value={{ organizationId: "fixture-org", userId: "fixture-user", userRole: "owner", userInitials: "T" }}><SellfoxCredentialsPanel /></AppShellUserProvider>);
