"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, LogIn, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAccessiblePathOrFallback, type RolePermissionMap } from "@/lib/accounts/permissions";

type AuthMode = "login" | "register";
type AuthResponse = {
  error?: string;
  user?: {
    role?: string;
  };
  rolePermissions?: RolePermissionMap;
};

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isRegister = mode === "register";

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError("");
    setConfirmPassword("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (isRegister && password !== confirmPassword) {
      setError("两次输入的密码不一致。");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(isRegister ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(isRegister ? { email, name, password, confirmPassword } : { email, password }),
      });
      const payload = (await response.json()) as AuthResponse;

      if (!response.ok) {
        setError(payload.error ?? (isRegister ? "注册失败。" : "登录失败。"));
        return;
      }

      const nextPath = new URLSearchParams(window.location.search).get("next");

      router.replace(getAccessiblePathOrFallback(nextPath, payload.user?.role, payload.rolePermissions));
      router.refresh();
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : isRegister ? "注册失败。" : "登录失败。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <form onSubmit={handleSubmit} className="w-full max-w-[400px] rounded-lg border border-border bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-brand text-white">
            <LockKeyhole className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">{isRegister ? "注册 ERP 工作台" : "登录 ERP 工作台"}</h1>
            <p className="text-xs font-semibold text-muted">Amazon Bulk AD 内部系统</p>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-2 rounded-md border border-border bg-surface-muted p-1">
          <button
            type="button"
            onClick={() => switchMode("login")}
            className={`h-9 rounded text-sm font-bold transition-colors ${!isRegister ? "bg-white text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}
          >
            登录
          </button>
          <button
            type="button"
            onClick={() => switchMode("register")}
            className={`h-9 rounded text-sm font-bold transition-colors ${isRegister ? "bg-white text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}
          >
            注册
          </button>
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

        {isRegister ? (
          <label className="mb-4 block text-sm font-semibold text-foreground">
            真实姓名
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              type="text"
              autoComplete="name"
              className="mt-2 h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-brand"
              required
            />
          </label>
        ) : null}

        <label className="mb-4 block text-sm font-semibold text-foreground">
          密码
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete={isRegister ? "new-password" : "current-password"}
            minLength={isRegister ? 8 : undefined}
            className="mt-2 h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-brand"
            required
          />
        </label>

        {isRegister ? (
          <label className="mb-4 block text-sm font-semibold text-foreground">
            确认密码
            <input
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
              minLength={8}
              className="mt-2 h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-brand"
              required
            />
          </label>
        ) : null}

        {error ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p> : null}

        <Button type="submit" className="w-full" disabled={loading}>
          {isRegister ? <UserPlus className="mr-2 h-4 w-4" /> : <LogIn className="mr-2 h-4 w-4" />}
          {loading ? (isRegister ? "注册中..." : "登录中...") : isRegister ? "注册并进入" : "登录"}
        </Button>
      </form>
    </main>
  );
}
