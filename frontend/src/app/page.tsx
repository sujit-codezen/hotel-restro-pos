"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuthStore } from "@/lib/auth-store";
import { useAuthHydration, useCurrentUser } from "@/lib/hooks";

export default function RootPage() {
  const router = useRouter();
  const hydrated = useAuthHydration();
  const accessToken = useAuthStore((s) => s.accessToken);
  const { data: user, isLoading, isError } = useCurrentUser();

  useEffect(() => {
    if (!hydrated) return;
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    if (isLoading) return;
    if (isError) {
      router.replace("/login");
      return;
    }
    if (user && !user.organization_id) {
      router.replace("/setup");
      return;
    }
    if (user) {
      router.replace("/dashboard");
    }
  }, [hydrated, accessToken, user, isLoading, isError, router]);

  return (
    <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
      Loading…
    </div>
  );
}
