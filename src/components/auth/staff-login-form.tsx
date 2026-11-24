"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAccessiblePathOrFallback, type RolePermissionMap } from "@/lib/accounts/permissions";

type AuthResponse = {
  error?: string;
  organizations?: Array<{ id: string; name: string }>;
  user?: {
    role?: string;
  };
  rolePermissions?: RolePermissionMap;
};

/**
 * Internal staff sign-in form. Shared by the internal login routes so the
 * credential check, session handling and post-login routing stay identical.
 */
export function StaffLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);
  const [organizationId, setOrganizationId] = useState("");
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
        body: JSON.stringify({ email, password, ...(organizationId ? { organizationId } : {}) }),
      });
      const payload = (await response.json()) as AuthResponse;

      if (!response.ok) {
        if (response.status === 409 && payload.organizations?.length) {
          setOrganizations(payload.organizations);
          setOrganizationId("");
          setError(payload.error ?? "请选择要进入的组织。");
          return;
        }
        setError(payload.error ?? "登录失败。");
        return;
      }

      const nextPath = new URLSearchParams(window.location.search).get("next");

      router.replace(getAccessiblePathOrFallback(nextPath, payload.user?.role, payload.rolePermissions));
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "登录失败。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <form onSubmit={handleSubmit} className="w-full max-w-[400px] rounded-lg border border-border bg-surface p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-brand text-white">
            <LockKeyhole className="h-5 w-5" />
          </div>
        </div>

        <label className="mb-4 block text-sm font-semibold text-foreground">
          账号 / 手机号
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

        {organizations.length > 1 ? (
          <label className="mb-4 block text-sm font-semibold text-foreground">
            组织
            <select
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
              className="mt-2 h-10 w-full rounded-md border border-border bg-surface px-3 text-sm outline-none focus:border-brand"
              required
            >
              <option value="" disabled>请选择组织</option>
              {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
            </select>
          </label>
        ) : null}

        {error ? <p className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-sm font-semibold text-danger-ink">{error}</p> : null}

        <Button type="submit" className="w-full" disabled={loading}>
          <LogIn className="mr-2 h-4 w-4" />
          {loading ? "登录中..." : "登录"}
        </Button>
      </form>
    </main>
  );
}
