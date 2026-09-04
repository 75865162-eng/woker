"use client";

import Link, { type LinkProps } from "next/link";
import { useRouter } from "next/navigation";
import type { AnchorHTMLAttributes } from "react";

type PrefetchLinkProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
    href: string;
  };

export function PrefetchLink({ href, onFocus, onMouseEnter, ...props }: PrefetchLinkProps) {
  const router = useRouter();

  function prefetch() {
    router.prefetch(href);
  }

  return (
    <Link
      href={href}
      prefetch={false}
      onFocus={(event) => {
        prefetch();
        onFocus?.(event);
      }}
      onMouseEnter={(event) => {
        prefetch();
        onMouseEnter?.(event);
      }}
      {...props}
    />
  );
}
