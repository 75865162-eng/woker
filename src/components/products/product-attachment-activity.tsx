"use client";

import { createContext, useContext, useEffect } from "react";

export const ProductAttachmentActivityContext = createContext<((delta: number) => void) | null>(null);

/** Optional editor boundary; standalone trial forms keep their existing behavior. */
export function useProductAttachmentActivity(uploading: boolean) {
  const notify = useContext(ProductAttachmentActivityContext);
  useEffect(() => {
    if (!uploading || !notify) return;
    notify(1);
    return () => notify(-1);
  }, [uploading, notify]);
}
