import { AppShell } from "@/components/app-shell/app-shell";
import { ImageUpscaleWorkbench } from "@/components/image-upscale/image-upscale-workbench";

export default function ImageUpscalePage() {
  return (
    <AppShell title="图片放大" subtitle="本地图片超分辨率预处理工作台">
      <ImageUpscaleWorkbench />
    </AppShell>
  );
}
