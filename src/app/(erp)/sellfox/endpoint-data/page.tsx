import { AppShell } from "@/components/app-shell/app-shell";
import { EndpointDataWorkbench } from "./_components/EndpointDataWorkbench";

export const metadata = { title: "端点原始行" };

/** 服务端壳：AppShell 依赖 next/headers，交互逻辑必须放在客户端子组件里。 */
export default function EndpointDataPage() {
  return (
    <AppShell title="端点原始行" subtitle="赛狐泛化端点同步落库的接口原始响应，按端点逐行验收。">
      <EndpointDataWorkbench />
    </AppShell>
  );
}
