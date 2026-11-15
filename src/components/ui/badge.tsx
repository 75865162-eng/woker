import { cn } from "@/lib/utils";

/**
 * 语义徽标。取色走 --*-soft 浅底 + --*-ink 墨色，
 * 与 StatusPill 同源，替代原先的 bg-info-soft / text-success-ink 这类硬编码。
 *
 * 语义名：success / warning / danger / info / neutral。
 * 旧的绿/黄/红/蓝/灰命名保留为别名 —— 存量调用点还有 60 余处，
 * 且其中曾出现 good / warn 两个未定义取值（渲染时无任何样式），这里一并收口。
 */
const semanticTones = {
  success: "bg-success-soft text-success-ink border-success/25",
  warning: "bg-warning-soft text-warning-ink border-accent/30",
  danger: "bg-danger-soft text-danger-ink border-danger/25",
  info: "bg-info-soft text-info-ink border-info/25",
  neutral: "bg-surface-muted text-muted border-border",
} as const;

const tones = {
  ...semanticTones,
  green: semanticTones.success,
  amber: semanticTones.warning,
  red: semanticTones.danger,
  blue: semanticTones.info,
  gray: semanticTones.neutral,
  good: semanticTones.success,
  warn: semanticTones.warning,
};

export type BadgeTone = keyof typeof tones;

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-meta font-semibold", tones[tone], className)}>
      {children}
    </span>
  );
}
