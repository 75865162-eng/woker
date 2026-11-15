import { AppShell } from "@/components/app-shell/app-shell";
import { DesignShowcase } from "@/components/design/design-showcase";

export default function DesignPage() {
  return (
    <AppShell
      title="设计系统"
      subtitle="排版尺度与组件原语自检 · 视觉基准来自商品主档"
    >
      <DesignShowcase />
    </AppShell>
  );
}
