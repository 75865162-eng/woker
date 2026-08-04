import { AppShell } from "@/components/app-shell/app-shell";
import { ImageUpscaleWorkbench } from "@/components/image-upscale/image-upscale-workbench";
import { DataSourceBanner } from "@/components/ui/data-source-banner";

export default function ImageUpscalePage() {
  return (
    <AppShell title="图片放大" subtitle="商品图超分辨率预处理工作台">
      <div className="space-y-5">
        <DataSourceBanner
          tone="mixed"
          title="图片处理通过接口执行，资产归档仍待完善"
          description="上传和处理请求已走后端 API；处理前后的图片还没有完整绑定到 FileAsset、SKU 或任务历史，下一步适合接入数据库文件记录。"
        />
        <ImageUpscaleWorkbench />
      </div>
    </AppShell>
  );
}
