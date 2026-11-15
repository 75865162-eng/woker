"use client";

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 表单控件。
 *
 * 全部走 .erp-field 这套类（见 globals.css 第 5 层），高度为密度令牌
 * var(--control-h)，所以切换密度时表单与表格一起变。
 * 七种状态：default / hover / focus / active / disabled / loading / error(invalid)。
 */

/* ---------------------------------------------------------------- Field 容器 */

export function Field({
  label,
  hint,
  error,
  required = false,
  htmlFor,
  children,
  className,
  inline = false,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
  inline?: boolean;
}) {
  return (
    <div className={cn(inline ? "flex items-center gap-3" : "flex flex-col gap-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className={cn(
          "text-meta font-semibold text-muted",
          inline ? "shrink-0" : "flex items-center gap-1",
        )}
      >
        {label}
        {required ? (
          <span aria-hidden className="text-danger">
            *
          </span>
        ) : null}
      </label>
      <div className={cn(inline && "min-w-0 flex-1")}>{children}</div>
      {error ? (
        <p role="alert" className="text-label text-danger-ink">
          {error}
        </p>
      ) : hint ? (
        <p className="text-label text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/** 表单网格：2 列 / 3 列，窄屏自动落为单列 */
export function FormGrid({
  columns = 2,
  children,
  className,
}: {
  columns?: 1 | 2 | 3;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-x-4 gap-y-[var(--gap-field)]",
        columns === 1 && "grid-cols-1",
        columns === 2 && "grid-cols-1 md:grid-cols-2",
        columns === 3 && "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Fieldset({
  legend,
  description,
  children,
  actions,
}: {
  legend: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <fieldset className="min-w-0 rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <legend className="text-section text-foreground">{legend}</legend>
          {description ? <p className="mt-0.5 text-meta text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <div className="px-4 py-3">{children}</div>
    </fieldset>
  );
}

/* ------------------------------------------------------------------- Input */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /** 数字输入：等宽数字，纵向对齐 */
  numeric?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, numeric, leading, trailing, ...props },
  ref,
) {
  if (!leading && !trailing) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn("erp-field", numeric && "metric-tabular", className)}
        {...props}
      />
    );
  }

  return (
    <span className="relative flex items-center">
      {leading ? (
        <span className="pointer-events-none absolute left-2.5 flex items-center text-muted">{leading}</span>
      ) : null}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn("erp-field", leading && "pl-8", trailing && "pr-8", numeric && "metric-tabular", className)}
        {...props}
      />
      {trailing ? <span className="absolute right-2.5 flex items-center text-muted">{trailing}</span> : null}
    </span>
  );
});

/* ---------------------------------------------------------------- Textarea */

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, rows = 3, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        aria-invalid={invalid || undefined}
        className={cn(
          "erp-field h-auto py-2 leading-5",
          className,
        )}
        {...props}
      />
    );
  },
);

/* ------------------------------------------------------------------ Select */

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  options: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid, options, placeholder, ...props },
  ref,
) {
  return (
    <span className="relative flex items-center">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn("erp-field appearance-none pr-8", className)}
        {...props}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-muted" />
    </span>
  );
});

/* --------------------------------------------------------------- DatePicker */

export const DatePicker = forwardRef<HTMLInputElement, InputProps & { range?: boolean }>(function DatePicker(
  { className, range = false, type, ...props },
  ref,
) {
  return <Input ref={ref} type={range ? "date" : type ?? "date"} className={cn("metric-tabular", className)} {...props} />;
});

/* --------------------------------------------------------- Checkbox / Radio */

export function Checkbox({
  label,
  description,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <span className={cn("flex items-start gap-2", className)}>
      <input
        id={props.id ?? id}
        type="checkbox"
        className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer rounded-sm border-border accent-brand disabled:cursor-not-allowed"
        {...props}
      />
      {label ? (
        <label htmlFor={props.id ?? id} className="cursor-pointer text-body text-foreground">
          {label}
          {description ? <span className="mt-0.5 block text-meta text-muted">{description}</span> : null}
        </label>
      ) : null}
    </span>
  );
}

export function Radio({
  label,
  description,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <span className={cn("flex items-start gap-2", className)}>
      <input
        id={props.id ?? id}
        type="radio"
        className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer border-border accent-brand disabled:cursor-not-allowed"
        {...props}
      />
      {label ? (
        <label htmlFor={props.id ?? id} className="cursor-pointer text-body text-foreground">
          {label}
          {description ? <span className="mt-0.5 block text-meta text-muted">{description}</span> : null}
        </label>
      ) : null}
    </span>
  );
}

/** 分段单选：状态筛选、视图切换。比 select 少一次点击 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  size = "md",
}: {
  value: T;
  options: { value: T; label: ReactNode; count?: number }[];
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-surface-muted p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center gap-1 rounded-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
              size === "sm" ? "h-6 px-2 text-meta" : "h-7 px-2.5 text-meta",
              active ? "bg-surface text-foreground shadow-1" : "text-muted hover:text-foreground",
            )}
          >
            {option.label}
            {typeof option.count === "number" ? (
              <span className={cn("metric-tabular", active ? "text-brand" : "text-muted")}>{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
