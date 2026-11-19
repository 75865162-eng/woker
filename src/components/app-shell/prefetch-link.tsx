"use client";

import Link, { type LinkProps } from "next/link";
import type { AnchorHTMLAttributes } from "react";

type PrefetchLinkProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
    href: string;
  };

// Disable Next's built-in viewport RSC prefetch. This app keeps visited views
// mounted but hidden; their <Link>s stay in the viewport and fire batch RSC
// prefetches. When the user clicks quickly, the navigation request races those
// prefetches and gets aborted, leaving the page frozen until a hard refresh.
// First-screen data is still warmed by prefetchRouteData() (API-level, no RSC).
export function PrefetchLink({ href, ...props }: PrefetchLinkProps) {
  return <Link href={href} prefetch={false} {...props} />;
}
