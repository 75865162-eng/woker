import type { Metadata } from "next";
import {
  BadgeCheck,
  CalendarRange,
  CircleDollarSign,
  Crown,
  Gift,
  Keyboard,
  MousePointer2,
  Popcorn,
  Sparkles,
  Trophy,
  WalletCards,
} from "lucide-react";
import { AppShell } from "@/components/app-shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "爆米花奖励",
  description: "同事定级、积分成长和办公奖励兑换的一页式看板。",
};

const heroImages = [
  {
    src: "https://images.pexels.com/photos/7793999/pexels-photo-7793999.jpeg?auto=compress&cs=tinysrgb&w=1200",
    alt: "团队在办公室庆祝",
  },
  {
    src: "https://images.pexels.com/photos/4006158/pexels-photo-4006158.jpeg?auto=compress&cs=tinysrgb&w=1200",
    alt: "键盘和鼠标办公桌面",
  },
  {
    src: "https://images.pexels.com/photos/7718661/pexels-photo-7718661.jpeg?auto=compress&cs=tinysrgb&w=1200",
    alt: "办公用品平铺",
  },
];

const levels = [
  { name: "Pop 见习", range: "0 - 99 分", color: "gray", perk: "完成基础交付，进入积分体系。" },
  { name: "Pop 进阶", range: "100 - 249 分", color: "blue", perk: "可兑换常规办公用品与小额现金奖励。" },
  { name: "Pop 核心", range: "250 - 499 分", color: "amber", perk: "拥有更高兑换额度和优先假期排期。" },
  { name: "Pop 王牌", range: "500 分以上", color: "green", perk: "进入重点激励池，享受高价值兑换。" },
] as const;

const rewards = [
  { icon: CircleDollarSign, title: "RMB 兑换", cost: "100 分 = 20 元", note: "按月结算，适合快速奖励。" },
  { icon: MousePointer2, title: "无线鼠标", cost: "180 分", note: "适合长时间办公的轻量升级。" },
  { icon: Keyboard, title: "机械键盘", cost: "320 分", note: "适合高频编辑和数据操作。" },
  { icon: CalendarRange, title: "半天假期", cost: "380 分", note: "需主管确认，支持灵活补休。" },
  { icon: Gift, title: "办公用品礼包", cost: "120 分", note: "笔记本、收纳、桌面小物件。" },
  { icon: WalletCards, title: "储值卡", cost: "260 分", note: "用于更自由的个人奖励选择。" },
] as const;

const ruleItems = [
  { title: "结果导向", text: "按交付、质量、响应速度和 ownership 计分。" },
  { title: "协作加分", text: "支持跨组协作、带新人、救火补位可额外加分。" },
  { title: "透明扣分", text: "迟交、返工、缺席关键评审会按规则扣减。" },
  { title: "月度刷新", text: "积分按月汇总，季度复核定级。" },
] as const;

const processSteps = [
  "当月自评与同事互评",
  "主管复核积分与等级",
  "公示兑换清单和额度",
  "提交兑换申请并归档",
] as const;

const sourceLinks = [
  { label: "团队庆祝", href: "https://www.pexels.com/photo/people-celebrating-at-the-office-7793999/" },
  { label: "键盘鼠标", href: "https://www.pexels.com/photo/white-apple-keyboard-and-magic-mouse-4006158/" },
  { label: "办公用品平铺", href: "https://www.pexels.com/photo/a-flatlay-of-office-supplies-7718661/" },
] as const;

export default function BaomihuaPage() {
  return (
    <AppShell title="爆米花奖励" subtitle="同事定级、积分和兑换的单页看板">
      <main className="space-y-6">
        <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
            <div className="border-b border-border px-6 py-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="amber">
                  <Popcorn className="mr-1 h-3.5 w-3.5" />
                  爆米花奖励
                </Badge>
                <Badge tone="gray">定级系统</Badge>
                <Badge tone="blue">积分兑换</Badge>
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight text-foreground">让每个人的贡献，都能被看见、被计分、被兑换。</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
                这个页面用于同事定级、积分沉淀和奖励兑换。它把月度表现、协作价值和实际奖励放到同一张看板里，方便主管和同事快速对齐。
              </p>
            </div>

            <div className="grid gap-4 px-6 py-5 md:grid-cols-2">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ["本月新增", "248 分"],
                    ["已兑换", "16 笔"],
                    ["活跃同事", "31 人"],
                    ["最高等级", "Pop 王牌"],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-md border border-border bg-surface-muted px-3 py-3">
                      <div className="text-xs font-semibold text-muted">{label}</div>
                      <div className="mt-1 text-lg font-bold text-foreground metric-tabular">{value}</div>
                    </div>
                  ))}
                </div>

                <div className="rounded-md border border-border bg-surface-muted px-4 py-4">
                  <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                    <Sparkles className="h-4 w-4 text-brand" />
                    本月建议
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    对于连续两个月达到核心档位的同事，优先开放高价值兑换；对于协作贡献高的同事，保留额外加分名额。
                  </p>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button>查看积分规则</Button>
                  <Button variant="secondary">进入兑换清单</Button>
                </div>
              </div>

              <div className="grid gap-3">
                <div
                  className="relative min-h-[210px] overflow-hidden rounded-md border border-border bg-surface-muted"
                  style={{
                    backgroundImage: `linear-gradient(180deg, rgba(17,24,39,0.05), rgba(17,24,39,0.2)), url(${heroImages[0].src})`,
                    backgroundPosition: "center",
                    backgroundSize: "cover",
                  }}
                  aria-label={heroImages[0].alt}
                />
                <div className="grid grid-cols-2 gap-3">
                  {heroImages.slice(1).map((image) => (
                    <div
                      key={image.src}
                      className="min-h-[118px] rounded-md border border-border bg-surface-muted"
                      style={{
                        backgroundImage: `url(${image.src})`,
                        backgroundPosition: "center",
                        backgroundSize: "cover",
                      }}
                      aria-label={image.alt}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>素材与视觉方向</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-6 text-muted">
                主图用办公室庆祝场景，辅图用键盘鼠标和办公用品平铺，能同时表达“奖励”“办公用品兑换”“定级看板”三个关键词。
              </p>
              <div className="space-y-3">
                {sourceLinks.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-md border border-border bg-surface-muted px-3 py-3 text-sm font-semibold text-foreground hover:border-brand"
                  >
                    <span>{item.label}</span>
                    <span className="text-xs text-muted">Pexels</span>
                  </a>
                ))}
              </div>
              <div className="rounded-md border border-dashed border-border bg-white px-4 py-4">
                <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <Trophy className="h-4 w-4 text-accent" />
                  页面定位
                </div>
                <p className="mt-2 text-sm leading-6 text-muted">
                  这是一个一页式运营看板，不做营销落地页风格，重点是扫描快、规则清楚、兑换动作明确。
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <Card>
            <CardHeader>
              <CardTitle>定级梯度</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {levels.map((level) => (
                <div key={level.name} className="rounded-md border border-border bg-surface-muted px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Crown className="h-4 w-4 text-accent" />
                      <span className="text-sm font-bold text-foreground">{level.name}</span>
                    </div>
                    <Badge tone={level.color}>{level.range}</Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted">{level.perk}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>积分兑换</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2">
                {rewards.map((reward) => {
                  const Icon = reward.icon;

                  return (
                    <div key={reward.title} className="rounded-md border border-border bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-surface-muted text-brand">
                            <Icon className="h-5 w-5" />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-foreground">{reward.title}</h3>
                            <p className="mt-1 text-xs text-muted">{reward.note}</p>
                          </div>
                        </div>
                        <Badge tone="amber">{reward.cost}</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
          <Card>
            <CardHeader>
              <CardTitle>积分规则</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {ruleItems.map((item) => (
                <div key={item.title} className="rounded-md border border-border bg-surface-muted px-4 py-4">
                  <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                    <BadgeCheck className="h-4 w-4 text-success" />
                    {item.title}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted">{item.text}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>评审流程</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {processSteps.map((step, index) => (
                <div key={step} className="flex items-start gap-3 rounded-md border border-border bg-white px-4 py-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
                    {index + 1}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{step}</p>
                    <p className="mt-1 text-xs leading-5 text-muted">
                      让同事知道分数怎么来、等级怎么定、奖励怎么换。
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      </main>
    </AppShell>
  );
}
