import { createRoot } from "react-dom/client";
import { BrandAnalyticsWorkbench } from "@/components/operations/brand-analytics-workbench";
const headers = () => new Headers({ "x-workspace-id": "brand-fixture" });
createRoot(document.getElementById("root")!).render(<BrandAnalyticsWorkbench sellerAccountId="" marketplaceId="" getHeaders={headers} onTask={id => { document.body.dataset.task = id; }} canConfigure canCreate busy={false} initialView={new URLSearchParams(location.search).get("repeat") ? "repeat_purchase" : "overview"} onCommand={async command => { const response = await fetch("/api/operations/sync-center", { method: "POST", headers: { "content-type": "application/json", "x-workspace-id": "brand-fixture" }, body: JSON.stringify(command) }); return response.ok; }} />);
