import { ExternalLink } from "lucide-react";
import { buildAmazonLink } from "./product-workbench-utils";

export function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  size = "default",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  size?: "default" | "compact";
}) {
  const isNumberInput = type === "number";
  const heightClass = size === "compact" ? "h-8" : "h-10";

  return (
    <label className="text-xs font-semibold text-muted">
      {label}
      <input
        className={`mt-1 ${heightClass} w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-brand`}
        type={isNumberInput ? "text" : type}
        inputMode={isNumberInput ? "decimal" : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function ReadonlyMetric({ value }: { value: string | number }) {
  const text = typeof value === "number" ? value.toFixed(2) : value;
  return <td className="px-2 py-2 font-semibold text-muted metric-tabular">{text}</td>;
}

export function SmallInput({
  value,
  onChange,
  type = "text",
  compact = false,
}: {
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  compact?: boolean;
}) {
  const isNumberInput = type === "number";

  return (
    <input
      className={`h-8 rounded-md border border-border bg-white px-2 text-xs text-foreground outline-none focus:border-brand ${compact ? "w-[60px] min-w-[60px]" : "w-full min-w-[88px]"}`}
      type={isNumberInput ? "text" : type}
      inputMode={isNumberInput ? "decimal" : undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function SmallTextarea({
  value,
  onChange,
  size = "default",
  disabled = false,
}: {
  value: string | number;
  onChange: (value: string) => void;
  size?: "default" | "compact" | "negative" | "supplierCompact" | "supplierMedium" | "supplierWide";
  disabled?: boolean;
}) {
  const sizeClass =
    size === "compact"
      ? "h-[150px] w-[60px] min-w-[60px]"
      : size === "negative"
        ? "h-[180px] w-[150px] min-w-[150px]"
        : size === "supplierCompact"
          ? "h-[50px] w-[50px] min-w-[50px]"
          : size === "supplierMedium"
            ? "h-[50px] w-[150px] min-w-[150px]"
          : size === "supplierWide"
            ? "h-[50px] w-[180px] min-w-[180px]"
            : "min-h-20 w-full min-w-[120px]";

  return (
    <textarea
      className={`${sizeClass} rounded-md border border-border px-2 py-2 text-xs outline-none focus:border-brand ${disabled ? "cursor-not-allowed bg-surface-muted text-muted" : "bg-white text-foreground"}`}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function ExternalLinkButton({ href }: { href: string }) {
  const normalized = href.trim();
  const safeHref = normalized.startsWith("http://") || normalized.startsWith("https://") ? normalized : "";

  return (
    <a
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border ${safeHref ? "text-brand hover:border-brand" : "pointer-events-none text-muted opacity-50"}`}
      href={safeHref || "#"}
      target="_blank"
      rel="noreferrer"
      title="打开供应商链接"
    >
      <ExternalLink className="h-4 w-4" />
    </a>
  );
}

export function AmazonLinkButton({ asin }: { asin: string }) {
  const href = buildAmazonLink(asin);
  return (
    <a
      className={`inline-flex h-8 w-full items-center justify-center gap-1 rounded-md border border-border text-xs font-semibold ${href ? "text-brand hover:border-brand" : "pointer-events-none text-muted opacity-50"}`}
      href={href || "#"}
      target="_blank"
      rel="noreferrer"
      title="打开 Amazon 链接"
    >
      <ExternalLink className="h-3.5 w-3.5" />
      打开
    </a>
  );
}
