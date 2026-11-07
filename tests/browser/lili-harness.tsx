import { createRoot } from "react-dom/client";
import { CatalogContent } from "@/components/lili/catalog-content";
import { LiliNavigation } from "@/components/lili/navigation";
import { liliNavigation, resolveLiliPage } from "@/lib/lili/routes";

async function mount() {
  const route = resolveLiliPage(window.location.pathname.split("/").filter(Boolean).slice(1));
  if (!route) throw new Error("Unknown fixture route");
  const content = await CatalogContent({ kind: route.kind, slug: route.slug, locale: "zh" });
  createRoot(document.getElementById("root")!).render(<div className="lili-test-root p-5">
    <LiliNavigation locale="zh" allowedPaths={liliNavigation.map((item) => item.path)} />{content}
  </div>);
}
void mount();
