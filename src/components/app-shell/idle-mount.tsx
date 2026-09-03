"use client";

import { useEffect, useState } from "react";

export function IdleMount({
  children,
  fallback = null,
  timeoutMs = 1200,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  timeoutMs?: number;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supportsIdleCallback = typeof window.requestIdleCallback === "function";
    const markReady = () => {
      if (!cancelled) {
        setReady(true);
      }
    };

    const idleCallbackId: number = supportsIdleCallback
      ? window.requestIdleCallback(markReady, { timeout: timeoutMs })
      : window.setTimeout(markReady, timeoutMs);

    return () => {
      cancelled = true;
      if (supportsIdleCallback) {
        window.cancelIdleCallback(idleCallbackId);
      } else {
        window.clearTimeout(idleCallbackId);
      }
    };
  }, [timeoutMs]);

  return ready ? children : fallback;
}
