import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { CurrentUser, RolePermissions } from "@/lib/auth-store";
import { Store } from "@/lib/types";

/** localStorage isn't available during SSR, so the store starts empty and
 * must be hydrated client-side before any accessToken check is trustworthy
 * — otherwise every page briefly thinks the user is logged out. */
export function useAuthHydration() {
  const hydrate = useAuthStore((s) => s.hydrate);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    hydrate();
    setHydrated(true);
  }, [hydrate]);

  return hydrated;
}

export function useCurrentUser() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery<CurrentUser>({
    queryKey: ["me"],
    queryFn: async () => (await api.get("/auth/me/")).data,
    enabled: !!accessToken,
    retry: false,
  });
}

/** True if the user's assignment at the currently-selected store grants
 * `flag` — used to hide (not just 403 on click) nav items and buttons the
 * user's role doesn't allow. Backend enforcement is still the real
 * guard; this is purely UX so a Cashier doesn't have to discover "no
 * access" by clicking into Settings. */
export function useHasPermission(flag: keyof RolePermissions) {
  const { data: user } = useCurrentUser();
  const activeStoreId = useAuthStore((s) => s.activeStoreId);
  if (!user || !activeStoreId) return false;
  const assignment = user.store_roles.find((r) => r.store_id === activeStoreId);
  return assignment?.permissions[flag] ?? false;
}

export function useStores() {
  const { data: user } = useCurrentUser();
  return useQuery<Store[]>({
    queryKey: ["stores"],
    queryFn: async () => (await api.get("/stores/")).data.results,
    enabled: !!user?.organization_id,
  });
}

/** DRF's PageNumberPagination wraps list responses as {results: T[]}. */
export type Paginated<T> = { count: number; next: string | null; previous: string | null; results: T[] };
