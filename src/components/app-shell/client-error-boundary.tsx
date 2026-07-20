"use client";

import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";

type ClientErrorBoundaryState = {
  error: Error | null;
  errorInfo: ErrorInfo | null;
};

export class ClientErrorBoundary extends Component<{ children: ReactNode }, ClientErrorBoundaryState> {
  state: ClientErrorBoundaryState = {
    error: null,
    errorInfo: null,
  };

  static getDerivedStateFromError(error: Error) {
    return { error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ error, errorInfo });
  }

  render() {
    const { error, errorInfo } = this.state;

    if (!error) {
      return this.props.children;
    }

    return (
      <main className="min-h-screen bg-background px-6 py-10 text-foreground">
        <div className="mx-auto max-w-3xl rounded-lg border border-danger/30 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold text-danger">客户端运行错误</p>
          <h1 className="mt-2 text-2xl font-black">页面加载时发生异常</h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            请把下面的错误信息发给我，我就能准确定位是哪段前端代码在你的浏览器里失败。
          </p>
          <pre className="mt-5 max-h-[60vh] overflow-auto rounded-lg bg-surface-muted p-4 text-xs leading-5 text-foreground">
            {[
              error.name,
              error.message,
              error.stack,
              errorInfo?.componentStack,
            ]
              .filter(Boolean)
              .join("\n\n")}
          </pre>
        </div>
      </main>
    );
  }
}
