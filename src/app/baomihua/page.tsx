import type { Metadata } from "next";
import {
  BadgeCheck,
  CalendarRange,
  CircleDollarSign,
  Crown,
  Gift,
  HandCoins,
  Popcorn,
  Sparkles,
  Tag,
  Trophy,
  ShieldAlert,
  TimerReset,
  Users,
} from "lucide-react";
import { AppShell } from "@/components/app-shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "爆米花奖励",
  description: "同事定级、积分成长、兑换和扣减规则的一页式看板。",
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
  { name: "🍿小爆米花", title: "Lv1-6", range: "0 - 1999", color: "gray", perk: "新人、刚上手，刚拿到爆米花原料。" },
  { name: "🍿爆米花苞", title: "Lv7-10", range: "2000 - 5999", color: "blue", perk: "独立完成基础运营工作，产出稳定。" },
  { name: "🍿爆米花・膨膨", title: "Lv11-13", range: "6000 - 14999", color: "amber", perk: "骨干，能做爆款、解决复杂业务问题。" },
  { name: "🍿爆米花・爆桶", title: "Lv14-16", range: "15000 - 29999", color: "green", perk: "团队核心，能带项目、带新人，产出高。" },
  { name: "🍿爆米花・大王", title: "Lv17-18", range: "30000+", color: "blue", perk: "顶尖人员，打造大爆款、账号大盘贡献突出。" },
] as const;

const rewardGroups = [
  {
    title: "办公用品奖池",
    icon: Gift,
    items: [
      { points: "150 分", value: "24 元", content: "手机支架、数据线、桌面收纳、咖啡券" },
      { points: "300 分", value: "48 元", content: "无线鼠标、键盘膜、保温杯、笔记本套装" },
      { points: "500 分", value: "80 元", content: "机械键盘、无线耳机、充电宝、护眼台灯" },
      { points: "800 分", value: "128 元", content: "品牌鼠标、显示器支架、人体工学腰靠" },
      { points: "1200 分", value: "192 元", content: "降噪耳机、智能手环、品牌双肩包" },
      { points: "2000 分", value: "320 元", content: "27 寸显示器、电竞椅、扫地机器人" },
      { points: "35000 分", value: "5600 元", content: "iPad、Switch、品牌行李箱" },
    ],
  },
  {
    title: "现金奖池",
    icon: CircleDollarSign,
    items: [
      { points: "300 分", value: "48 元", content: "京东 E 卡 / 天猫超市卡" },
      { points: "600 分", value: "96 元", content: "现金红包" },
      { points: "1000 分", value: "160 元", content: "星巴克星礼卡 / 电影票通兑" },
      { points: "1500 分", value: "240 元", content: "加油卡 / 话费充值" },
    ],
  },
  {
    title: "福利权益",
    icon: CalendarRange,
    items: [
      { points: "1250 分", value: "200 元", content: "0.5 天福利假" },
      { points: "2500 分", value: "400 元", content: "1 天福利假" },
      { points: "4000 分", value: "640 元", content: "2 天连休福利假" },
      { points: "800 分", value: "128 元", content: "远程办公 1 天券" },
    ],
  },
  {
    title: "特殊权益",
    icon: HandCoins,
    items: [
      { points: "3000 分", value: "约 480 元", content: "全公司下午茶报销 1 次" },
      { points: "100 分", value: "约 16 元", content: "优先选工位 / 优先领用新电脑" },
      { points: "1000 分", value: "约 160 元", content: "和主管一对一午餐交流" },
      { points: "1200 分", value: "约 192 元", content: "公司付费体检加项套餐" },
    ],
  },
] as const;

const earningRules = [
  { title: "结果交付", text: "按月目标完成率、项目结案、爆款贡献计分。", points: "+20 ~ +200" },
  { title: "质量稳定", text: "返工少、错误率低、数据准确可加分。", points: "+10 ~ +80" },
  { title: "协作贡献", text: "跨组支持、带新人、补位救火、分享方法论。", points: "+20 ~ +120" },
  { title: "主动创新", text: "流程优化、自动化、显著提效或降本。", points: "+30 ~ +200" },
  { title: "专项奖励", text: "阶段性大项目、重要节点、超预期产出。", points: "+100 ~ +500" },
] as const;

const useSteps = [
  "每月由主管或负责人统一发放基础爆米花俸禄。",
  "个人通过工作表现累计积分，进入对应等级。",
  "达到兑换门槛后提交申请，按奖池规则扣减积分。",
  "兑换结果在月度公示，权益类奖励需二次确认。",
] as const;

const deductionRules = [
  { title: "延迟交付", text: "单次轻微延迟 -10 到 -30；影响联动进度 -50 起。" },
  { title: "质量返工", text: "出现明显返工、重复修正或数据错误 -20 到 -80。" },
  { title: "沟通缺失", text: "未及时同步风险、失联或遗漏关键人 -10 到 -50。" },
  { title: "会议缺席", text: "无故缺席重要评审 / 复盘 / 对齐会 -10 到 -30。" },
  { title: "流程违规", text: "私自跳过审批、误用资源、信息不合规 -30 到 -120。" },
  { title: "重大事故", text: "对业务产生实际损失或严重影响，单独评估扣减。" },
] as const;

const operationNotes = [
  { title: "怎么使用", icon: Users, text: "月初发俸禄，月中累计积分，月末确认等级与兑换资格。" },
  { title: "怎么兑换", icon: Tag, text: "先兑换低门槛实物，再兑换高价值奖品，权益类优先走审批。" },
  { title: "怎么扣减", icon: ShieldAlert, text: "扣减只针对可确认行为，必须有记录，避免拍脑袋扣分。" },
  { title: "怎么刷新", icon: TimerReset, text: "建议按月结算、季度复盘、年度重置等级视业务再定。" },
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
                这个页面把你的爆米花体系整理成可执行制度：先定级，再积分，再兑换，最后扣减和复盘。所有规则都放在一页里，方便同事和主管直接照着走。
              </p>
            </div>

            <div className="grid gap-4 px-6 py-5 md:grid-cols-2">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ["本月新增", "248 分"],
                    ["已兑换", "16 笔"],
                    ["活跃同事", "31 人"],
                    ["最高等级", "Lv17-18"],
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
                    运行建议
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    低门槛奖品先换，福利类权益走审批，扣分一定要有记录。积分最好按月发放、按月兑换、按季度复盘。
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
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={level.color}>{level.title}</Badge>
                      <Badge tone={level.color}>{level.range} 分</Badge>
                    </div>
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
            <CardContent className="space-y-4">
              {rewardGroups.map((group) => {
                const Icon = group.icon;

                return (
                  <div key={group.title} className="rounded-md border border-border bg-surface-muted px-4 py-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                      <Icon className="h-4 w-4 text-brand" />
                      {group.title}
                    </div>
                    <div className="mt-3 grid gap-2">
                      {group.items.map((item) => (
                        <div key={`${group.title}-${item.points}`} className="flex flex-col gap-2 rounded-md border border-border bg-white px-3 py-3 md:flex-row md:items-center md:justify-between">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone="amber">{item.points}</Badge>
                            <span className="text-sm font-semibold text-foreground">{item.value}</span>
                          </div>
                          <p className="text-xs leading-5 text-muted">{item.content}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
          <Card>
            <CardHeader>
              <CardTitle>怎么积分</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {earningRules.map((item) => (
                <div key={item.title} className="rounded-md border border-border bg-surface-muted px-4 py-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                      <BadgeCheck className="h-4 w-4 text-success" />
                      {item.title}
                    </div>
                    <Badge tone="green">{item.points}</Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted">{item.text}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>怎么使用</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {useSteps.map((step, index) => (
                <div key={step} className="flex items-start gap-3 rounded-md border border-border bg-white px-4 py-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
                    {index + 1}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{step}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
          <Card>
            <CardHeader>
              <CardTitle>怎么扣减</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {deductionRules.map((item) => (
                <div key={item.title} className="rounded-md border border-border bg-surface-muted px-4 py-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                      <ShieldAlert className="h-4 w-4 text-danger" />
                      {item.title}
                    </div>
                    <Badge tone="red">扣减</Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted">{item.text}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>执行口径</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {operationNotes.map((item) => {
                const Icon = item.icon;

                return (
                  <div key={item.title} className="rounded-md border border-border bg-white px-4 py-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                      <Icon className="h-4 w-4 text-brand" />
                      {item.title}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted">{item.text}</p>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </section>
      </main>
    </AppShell>
  );
}
