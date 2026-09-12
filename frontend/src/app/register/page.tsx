"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { AuthLayout } from "@/components/auth-layout";
import { Label } from "@/components/ui/input";
import { IconInput, LockIcon, MailIcon, UserIcon } from "@/components/ui/icon-input";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn } from "@/lib/utils";

export default function RegisterPage() {
  const router = useRouter();
  const setTokens = useAuthStore((s) => s.setTokens);
  const [form, setForm] = useState({ first_name: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post("/auth/register/", form);
      const { data } = await api.post("/auth/login/", {
        email: form.email,
        password: form.password,
      });
      setTokens(data.access, data.refresh);
      router.replace("/setup");
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: Record<string, string[]> } })?.response?.data;
      setError(message ? JSON.stringify(message) : "Registration failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Set up billing for your restaurant or hotel in minutes"
      subtitle="Pick your business type after signing up — we configure the rest."
    >
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-neutral-900">Create your account</h1>
        <p className="mt-1 text-sm text-neutral-500">Start with a free workspace for your team.</p>

        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          <div>
            <Label htmlFor="first_name">Name</Label>
            <IconInput
              id="first_name"
              required
              icon={<UserIcon />}
              value={form.first_name}
              onChange={(e) => setForm({ ...form, first_name: e.target.value })}
              placeholder="Your name"
            />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <IconInput
              id="email"
              type="email"
              required
              icon={<MailIcon />}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="you@business.com"
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <IconInput
              id="password"
              type="password"
              minLength={8}
              required
              icon={<LockIcon />}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="At least 8 characters"
            />
          </div>

          {error && (
            <p className="break-words rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className={cn(
              "flex h-11 w-full items-center justify-center rounded-xl bg-[#E5484D] text-sm font-medium text-white transition-colors",
              "hover:bg-[#D6393E] disabled:opacity-60"
            )}
          >
            {loading ? "Creating…" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-neutral-500">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-[#E5484D] hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
