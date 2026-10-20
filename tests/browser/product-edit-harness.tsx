import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppShellUserProvider } from "@/components/app-shell/app-shell-context";
import { ProductEditor } from "@/components/products/product-workbench";
import type { Product } from "@/lib/products/types";
import * as repository from "@/lib/products/product-edit-draft-repository";

Object.assign(window, { productDraftRepository: repository });

function Harness() {
  const [product, setProduct] = useState<Product | null>(null);
  const [opened, setOpened] = useState(true);
  const params = new URLSearchParams(location.search);
  const userId = params.get("user") || "user-1";
  const organizationId = params.get("org") || "org-1";
  const workspaceId = params.get("workspace") || "default";
  localStorage.setItem("amazon_bulk_ad_workspace_scope", JSON.stringify({ workspaceId }));
  useEffect(() => { void fetch("/api/products/SKU-1/detail").then((response) => response.json()).then((data: { product: Product }) => setProduct(data.product)); }, [opened]);
  return <AppShellUserProvider value={{ organizationId, userId, userName: "测试编辑者", userInitials: "T" }}>
    <button onClick={() => setOpened(true)}>打开编辑器</button>
    {opened && product ? <ProductEditor product={params.get("mode") === "import" ? null : product} initialDraft={params.get("mode") === "import" ? { ...product, revision: undefined } : undefined} products={[product]} nextSku="SKU-2" creatorName="测试编辑者" creatorUserId={userId} detailReady opsOptions={[]} designerOptions={[]}
      onClose={() => setOpened(false)} onSave={async (form) => {
        const response = await fetch("/api/products", { method: "POST", body: JSON.stringify({ product: form }) });
        const data = await response.json() as { product?: Product; error?: string };
        if (!response.ok) {
          const error = new Error(data.error || "商品保存失败");
          if (response.status === 409) error.name = "ProductRevisionConflictError";
          throw error;
        }
      }} /> : null}
  </AppShellUserProvider>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
