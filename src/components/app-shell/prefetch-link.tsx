"use client";

import Link, { type LinkProps } from "next/link";
import type { AnchorHTMLAttributes } from "react";

type PrefetchLinkProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
    href: string;
  };

// Kept as a named wrapper so call sites stay stable, but the previous
// `prefetch={false}` + hover-only `router.prefetch()` combination made clicks
// race against a half-finished prefetch (which is slower than no prefetch at
// all). Next's built-in viewport prefetch finishes long before the pointer
// arrives, so just delegate to <Link>.
export function PrefetchLink({ href, ...props }: PrefetchLinkProps) {
  return <Link href={href} {...props} />;
}
