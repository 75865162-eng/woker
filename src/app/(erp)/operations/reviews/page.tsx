import { AppShell } from '@/components/app-shell/app-shell';
import { ReviewsWorkbench } from '@/components/operations/ext/reviews-workbench';

export default function Page() {
  return <AppShell title="评论与店铺绩效" subtitle="评论/差评跟踪、处置记录与店铺绩效快照判定"><ReviewsWorkbench /></AppShell>;
}
