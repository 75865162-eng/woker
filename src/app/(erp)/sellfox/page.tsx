import { AppShell } from "@/components/app-shell/app-shell";
import { SellfoxHub } from "@/components/sellfox/sellfox-hub";
import { SellfoxAdsProposals } from "@/components/sellfox/sellfox-ads-proposals";
import { SellfoxWorkbench } from "@/components/sellfox/sellfox-workbench";
import { replicaPage, type ReplicaId } from "@/lib/sellfox/replica-pages";
import { ReplicaById } from "./replica-by-id";

export const metadata = { title: "赛狐数据中台" };

const replicaIds = new Set<ReplicaId>(["sales", "performance", "listings", "orders", "shipments", "restock"]);

export default async function SellfoxPage({ searchParams }: { searchParams: Promise<{ domain?: string | string[] }> }) {
  const params = await searchParams;
  const raw = Array.isArray(params.domain) ? params.domain[0] : params.domain;
  if (!raw) {
    return (
      <AppShell title="赛狐数据中台" subtitle="全量数据域接入进度、同步状态与拉取入口；数据经服务端后台调用赛狐 Open API">
        <div className="flex flex-col gap-3">
          <SellfoxHub />
          <SellfoxAdsProposals />
        </div>
      </AppShell>
    );
  }
  const page = raw && replicaIds.has(raw as ReplicaId) ? replicaPage(raw) : undefined;
  return (
    <AppShell title={page?.title ?? "销量统计 / 销售利润"} subtitle={page?.subtitle ?? "销量统计、销售利润、在线产品与广告产品；灰色控件表示赛狐网页有、本地尚无对应数据"}>
      {page ? <ReplicaById id={page.id} /> : <SellfoxWorkbench />}
    </AppShell>
  );
}
