"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "登录失败。");
        return;
      }

      const nextPath = new URLSearchParams(window.location.search).get("next");

      router.replace(nextPath || "/");
      router.refresh();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <form onSubmit={handleSubmit} className="w-full max-w-[380px] rounded-lg border border-border bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-brand text-white">
            <LockKeyhole className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">登录 ERP 工作台</h1>
            <p className="text-xs font-semibold text-muted">Amazon Bulk AD 内部系统</p>
          </div>
        </div>

        <label className="mb-4 block text-sm font-semibold text-foreground">
          账号
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="text"
            autoComplete="username"
            className="mt-2 h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-brand"
            required
          />
        </label>

        <label className="mb-4 block text-sm font-semibold text-foreground">
          密码
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
            className="mt-2 h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-brand"
            required
          />
        </label>

        {error ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p> : null}

        <Button type="submit" className="w-full" disabled={loading}>
          <LogIn className="mr-2 h-4 w-4" />
          {loading ? "登录中..." : "登录"}
        </Button>
      </form>
    </main>
  );
}
