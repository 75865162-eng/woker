"use client";

/**
 * 数据可用性承接卡（商用口径）。
 *
 * 用途：当某个 Amazon 业务页因「官方授权未核验 / 账号范围未分配 / 能力未接入 /
 * 读取失败」而无法呈现数据时，用统一的、面向业务用户的说明替代裸红字或空白。
 *
 * 纪律：
 * - 只描述状态、原因与下一步，不渲染任何编造的数据行或数字。
 * - 不改写授权、不发起同步、不绕过任何安全边界；所有动作仅是跳转到既有页面。
 * - 「数据保留」表述基于事实：服务端已发布快照不受页面展示影响。
 */

import Link from "next/link";
import { AlertTriangle, ArrowRight, Clock3, LockKeyhole, PlugZap, ShieldCheck } from "lucide-react";

export type ReadinessKind = "authorization" | "scope" | "not-configured" | "capability" | "error";

type Preset = {
  badge: string;
  tone: "warning" | "info" | "neutral" | "danger";
  icon: typeof ShieldCheck;
  title: string;
  reason: string;
  next: string;
  keep: string;
  href: string;
  action: string;
};

const presets: Record<ReadinessKind, Preset> = {
  authorization: {
    badge: "待官方身份核验",
    tone: "warning",
    icon: ShieldCheck,
    title: "该页面的数据暂未开放查看",
    reason:
      "Amazon 官方身份核验尚未完成。出于账号与资金安全要求，未核验前系统会拦截数据展示，即使报表已同步到本地也不会在此页列出。",
    next: "请到「店铺与授权」用管理员账号重新连接该店铺并完成身份核验；核验通过后无需改动本页面，数据将按原权限正常显示。",
    keep: "已同步的报表与快照安全保留在服务端，本页未读取、未修改任何授权或数据。",
    href: "/settings/amazon-connections",
    action: "前往店铺与授权",
  },
  scope: {
    badge: "待分配账号范围",
    tone: "info",
    icon: LockKeyhole,
    title: "当前账号还没有可查看的店铺范围",
    reason: "你的账号尚未被分配可访问的 Amazon 店铺 / 站点，因此没有可展示的数据范围。",
    next: "请联系管理员在「店铺与授权」为你分配对应的店铺与站点权限后重试。",
    keep: "页面未改动任何账号或授权配置。",
    href: "/operations?view=connections",
    action: "查看店铺与授权",
  },
  "not-configured": {
    badge: "待配置数据源",
    tone: "info",
    icon: PlugZap,
    title: "该数据域尚未配置同步来源",
    reason: "当前还没有为这个数据域配置可用的店铺数据源，因此没有可展示的已发布数据。",
    next: "请在「店铺与授权」确认店铺连接后，到同步中心为该数据域配置并运行一次采集。",
    keep: "页面未发起同步，也未写入任何数据。",
    href: "/operations?view=connections",
    action: "查看店铺与授权",
  },
  capability: {
    badge: "能力规划中",
    tone: "neutral",
    icon: Clock3,
    title: "该能力尚未接入",
    reason:
      "此功能已列入规划，但对应的官方接口与采集能力尚未接入，当前没有可查询的数据。为避免误读，页面不会用其他来源的数据代替。",
    next: "你可以先查看下方已接入的相邻能力；如需优先接入本能力，请联系系统管理员登记需求。",
    keep: "页面未填充任何占位数据或零值。",
    href: "/operations?view=overview",
    action: "查看已接入能力",
  },
  error: {
    badge: "暂时无法读取",
    tone: "danger",
    icon: AlertTriangle,
    title: "数据暂时无法读取",
    reason: "读取数据时出现异常，可能是服务暂时不可用、配置未完成或权限不足。",
    next: "请稍后重试；若持续出现，请联系管理员并提供发生时间，系统未返回内部错误或凭证。",
    keep: "页面未改动任何数据或配置。",
    href: "",
    action: "",
  },
};

const toneClass: Record<Preset["tone"], string> = {
  warning: "border-warning-ink/30 bg-warning-soft text-warning-ink",
  info: "border-info/30 bg-info-soft text-info-ink",
  neutral: "border-border bg-surface-muted text-muted",
  danger: "border-danger/30 bg-danger-soft text-danger-ink",
};

/**
 * @param kind 可用性类型
 * @param detail 可选：服务端返回的原始提示（仅作补充展示，不含凭证）
 * @param links 可选：额外的相邻能力 / 帮助链接
 */
export function ReadinessNotice({
  kind,
  detail,
  links,
  className,
}: {
  kind: ReadinessKind;
  detail?: string;
  links?: Array<{ href: string; label: string }>;
  className?: string;
}) {
  const preset = presets[kind];
  const Icon = preset.icon;
  return (
    <section
      role="status"
      aria-label={preset.title}
      className={`rounded-lg border border-dashed border-border bg-surface p-5 sm:p-6 ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${toneClass[preset.tone]}`}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <span className={`inline-flex rounded-full border px-2 py-0.5 text-meta font-semibold ${toneClass[preset.tone]}`}>
            {preset.badge}
          </span>
          <h2 className="mt-2 text-section font-semibold text-foreground">{preset.title}</h2>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted">{preset.reason}</p>
          <div className="mt-3 grid gap-2 border-l-2 border-border pl-3 text-xs leading-relaxed">
            <p><span className="font-semibold text-foreground">怎么处理：</span><span className="text-muted">{preset.next}</span></p>
            <p><span className="font-semibold text-foreground">数据说明：</span><span className="text-muted">{preset.keep}</span></p>
          </div>
          {detail ? (
            <details className="mt-3 text-xs text-muted">
              <summary className="cursor-pointer">查看系统提示</summary>
              <p className="mt-1 break-words rounded border border-border bg-surface-muted/40 p-2">{detail}</p>
            </details>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-4">
            {preset.action ? (
              <Link
                href={preset.href}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-dark"
              >
                {preset.action}<ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            ) : null}
            {(links ?? []).map(link => (
              <Link key={link.href} href={link.href} className="inline-flex h-9 items-center text-xs font-semibold text-brand hover:underline">
                {link.label} →
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** 把同步中心错误码映射为承接卡类型；未知错误一律落到通用 error。 */
export function readinessKindFromCode(code?: string): ReadinessKind {
  if (code === "AMAZON_AUTHORIZATION_INVALID") return "authorization";
  if (code === "ACCOUNT_SCOPE_REQUIRED" || code === "AMAZON_SCOPE_EMPTY") return "scope";
  if (code === "DATA_SOURCE_NOT_CONFIGURED") return "not-configured";
  return "error";
}
