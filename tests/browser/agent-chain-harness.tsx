import { createRoot } from "react-dom/client";
import { AppShellUserProvider } from "@/components/app-shell/app-shell-context";
import { OrchestratorAgentWorkbench } from "@/components/agents/orchestrator-agent-workbench";
import { MarketAgentWorkbench } from "@/components/agents/market-agent-workbench";
import { ProductAgentWorkbench } from "@/components/agents/product-agent-workbench";
import { SupplierAgentWorkbench } from "@/components/agents/supplier-agent-workbench";
import { ListingAgentWorkbench } from "@/components/agents/listing-agent-workbench";
import { PpcAgentWorkbench } from "@/components/agents/ppc-agent-workbench";

if (!localStorage.getItem("amazon_bulk_ad_workspace_scope")) localStorage.setItem("amazon_bulk_ad_workspace_scope", JSON.stringify({ workspaceId: "workspace-a", marketplace: "US" }));
const views = { orchestrator: OrchestratorAgentWorkbench, market: MarketAgentWorkbench, product: ProductAgentWorkbench, supplier: SupplierAgentWorkbench, listing: ListingAgentWorkbench, ppc: PpcAgentWorkbench };
const stage = location.pathname.split("/").pop() as keyof typeof views;
const View = views[stage] ?? OrchestratorAgentWorkbench;
createRoot(document.getElementById("root")!).render(<AppShellUserProvider value={{ organizationId: "org", userId: "actor", userRole: "owner", userInitials: "T" }}><View /></AppShellUserProvider>);
