"use client";
import { useEffect, useRef } from "react";

export type UseVisiblePollingOptions = {
  /** Polling interval in milliseconds. */
  intervalMs: number;
  /** Business switch — only poll when true (e.g. a job is running / there are unread items). */
  enabled: boolean;
  /** Skip a tick while a request is already in flight (keeps the existing `!busy` semantics). */
  busy?: boolean;
  onPoll: () => void | Promise<void>;
  /** Refresh once immediately when the tab returns to the foreground. Default true. */
  refreshOnVisible?: boolean;
};

/**
 * A visibility-aware polling hook.
 *
 * - No timer is created while `enabled === false`.
 * - Each tick runs only when the document is visible and `busy` is false.
 * - When the tab is hidden the timer is cleared; on return it is recreated and
 *   (by default) refreshes once immediately.
 * - `onPoll` / `busy` are read through refs so changing them does not tear down
 *   the timer; only `enabled` and `intervalMs` control the timer lifecycle.
 */
export function useVisiblePolling({
  intervalMs,
  enabled,
  busy = false,
  onPoll,
  refreshOnVisible = true,
}: UseVisiblePollingOptions): void {
  const onPollRef = useRef(onPoll);
  const busyRef = useRef(busy);
  onPollRef.current = onPoll;
  busyRef.current = busy;

  useEffect(() => {
    if (!enabled) return;
    if (typeof document === "undefined") return;

    let timer: number | undefined;
    const start = () => {
      if (timer !== undefined) return;
      timer = window.setInterval(() => {
        if (document.hidden || busyRef.current) return;
        void onPollRef.current();
      }, intervalMs);
    };
    const stop = () => {
      if (timer === undefined) return;
      window.clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        start();
        if (refreshOnVisible && !busyRef.current) void onPollRef.current();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs, refreshOnVisible]);
}
