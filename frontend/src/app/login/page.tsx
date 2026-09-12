"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { AuthLayout } from "@/components/auth-layout";
import { Label } from "@/components/ui/input";
import { IconInput, LockIcon, MailIcon } from "@/components/ui/icon-input";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn } from "@/lib/utils";

export default function LoginPage() {
  const router = useRouter();
  const setTokens = useAuthStore((s) => s.setTokens);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login/", { email, password });
      setTokens(data.access, data.refresh);
      router.replace("/");
    } catch {
      setError("Invalid email or password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Run your whole front-of-house from one screen"
      subtitle="Tables, kitchen, rooms and billing — built for restaurants and hotels."
    >
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-neutral-900">Welcome back</h1>
        <p className="mt-1 text-sm text-neutral-500">Sign in to your account to continue.</p>

        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          <div>
            <Label htmlFor="email">Email</Label>
            <IconInput
              id="email"
              type="email"
              required
              icon={<MailIcon />}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@business.com"
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <IconInput
              id="password"
              type="password"
              required
              icon={<LockIcon />}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className={cn(
              "flex h-11 w-full items-center justify-center rounded-xl bg-[#E5484D] text-sm font-medium text-white transition-colors",
              "hover:bg-[#D6393E] disabled:opacity-60"
            )}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-neutral-500">
          No account?{" "}
          <Link href="/register" className="font-medium text-[#E5484D] hover:underline">
            Register
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
