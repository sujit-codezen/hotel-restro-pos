"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  BedIcon,
  CalendarIcon,
  ChartIcon,
  GearIcon,
  GridIcon,
  ListIcon,
  LogoutIcon,
  MenuIcon,
  MonitorIcon,
  TableIcon,
  TagIcon,
  UsersIcon,
  UtensilsIcon,
  XIcon,
} from "@/components/ui/icons";
import { UserIcon } from "@/components/ui/icon-input";
import { RolePermissions, useAuthStore } from "@/lib/auth-store";
import { useAuthHydration, useCurrentUser, useHasPermission, useStores } from "@/lib/hooks";
import { cn } from "@/lib/utils";

// `permission`, where set, is purely UX — it hides an item the user's
// role doesn't grant rather than letting them click into a 403. The
// backend check (core.permissions.require_permission) is the real guard;
// items with no `permission` aren't gated server-side either (Customers),
// so nothing here should hide them.
//
// Table setup and room-type setup live inside the Tables/Rooms working
// screens themselves (add/edit popups), not as separate admin pages —
// so there's no standalone nav entry for either.
const NAV: {
  href: string;
  label: string;
  icon: typeof GridIcon;
  permission?: keyof RolePermissions;
}[] = [
  { href: "/dashboard", label: "Dashboard", icon: GridIcon },
  { href: "/pos", label: "POS", icon: UtensilsIcon },
  { href: "/pos/tables", label: "Tables", icon: TableIcon },
  { href: "/kds", label: "Kitchen", icon: MonitorIcon },
  { href: "/hotel/rooms", label: "Rooms", icon: BedIcon },
  { href: "/hotel/reservations", label: "Reservations", icon: CalendarIcon },
  { href: "/admin/menu", label: "Menu", icon: ListIcon, permission: "can_manage_menu" },
  { href: "/admin/discounts", label: "Discounts", icon: TagIcon, permission: "can_manage_discounts" },
  { href: "/admin/customers", label: "Customers", icon: UserIcon },
  { href: "/admin/staff", label: "Staff", icon: UsersIcon, permission: "can_manage_staff" },
  { href: "/admin/roles", label: "Roles", icon: UsersIcon, permission: "can_manage_staff" },
  { href: "/admin/reports", label: "Reports", icon: ChartIcon, permission: "can_view_reports" },
  { href: "/admin/settings", label: "Settings", icon: GearIcon, permission: "can_access_settings" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const hydrated = useAuthHydration();
  const accessToken = useAuthStore((s) => s.accessToken);
  const logout = useAuthStore((s) => s.logout);
  const activeStoreId = useAuthStore((s) => s.activeStoreId);
  const setActiveStoreId = useAuthStore((s) => s.setActiveStoreId);
  const { data: user, isLoading, isError } = useCurrentUser();
  const { data: stores } = useStores();

  // Fixed set of hook calls (not looped over NAV) since hooks can't be
  // called conditionally/dynamically — this map then drives the filter.
  const permissions: Record<keyof RolePermissions, boolean> = {
    can_refund_or_void: useHasPermission("can_refund_or_void"),
    can_manage_staff: useHasPermission("can_manage_staff"),
    can_access_settings: useHasPermission("can_access_settings"),
    can_manage_menu: useHasPermission("can_manage_menu"),
    can_manage_discounts: useHasPermission("can_manage_discounts"),
    can_view_reports: useHasPermission("can_view_reports"),
  };
  const visibleNav = NAV.filter((item) => !item.permission || permissions[item.permission]);

  // The single longest href that's an exact or parent match for the
  // current path — e.g. on /pos/tables, "/pos/tables" (exact) wins over
  // "/pos" (also a prefix match), so only one nav item lights up instead
  // of both.
  const activeHref = visibleNav
    .filter((item) => pathname === item.href || pathname?.startsWith(item.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!hydrated) return;
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    if (isError) {
      router.replace("/login");
      return;
    }
    if (!isLoading && user && !user.organization_id) {
      router.replace("/setup");
    }
  }, [hydrated, accessToken, user, isLoading, isError, router]);

  useEffect(() => {
    if (!stores || stores.length === 0) return;
    // A stale activeStoreId can outlive the account that set it (e.g. the
    // browser switches to a different login without an explicit logout),
    // which would otherwise silently break every store-scoped permission
    // check and API call — so re-pick whenever it's missing or no longer
    // one of the current user's stores.
    if (!activeStoreId || !stores.some((s) => s.id === activeStoreId)) {
      setActiveStoreId(stores[0].id);
    }
  }, [stores, activeStoreId, setActiveStoreId]);

  if (!hydrated || !accessToken || isLoading || !user?.organization_id) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-neutral-500">
        Loading…
      </div>
    );
  }

  return (
    // h-screen + overflow-hidden pins this to exactly the viewport height
    // so the page itself never scrolls — the sidebar's nav and the main
    // content area each get their own bounded, independent scroll region
    // below (both already had overflow-y-auto, but that only does
    // anything once the box it's on is actually height-constrained).
    // Without this, the whole document scrolled as one, taking the
    // sidebar along with it and leaving the Order List panel's
    // lg:sticky with the wrong scrolling ancestor to stick within.
    <div className="flex h-screen flex-col overflow-hidden bg-neutral-50 lg:flex-row">
      {/* Mobile-only top bar — the sidebar itself is an off-canvas drawer
          below the lg breakpoint, since a fixed 224px-wide rail eats over
          half of a phone screen. */}
      <div className="flex items-center gap-3 border-b border-neutral-200 bg-white p-3 lg:hidden">
        <button
          onClick={() => setMobileNavOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100"
          aria-label="Open menu"
        >
          <MenuIcon className="h-5 w-5" />
        </button>
        <p className="text-base font-extrabold leading-none text-[#E5484D]">
          POS <span className="text-neutral-900">Restro</span>
        </p>
      </div>

      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 -translate-x-full flex-col border-r border-neutral-200 bg-white transition-transform duration-200 lg:static lg:z-auto lg:h-full lg:w-56 lg:shrink-0 lg:translate-x-0",
          mobileNavOpen && "translate-x-0"
        )}
      >
        <div className="flex items-center justify-between border-b border-neutral-100 p-4">
          <div>
            <p className="text-lg font-extrabold leading-none text-[#E5484D]">
              POS <span className="text-neutral-900">Restro</span>
            </p>
            <p className="mt-1 truncate text-xs text-neutral-400">{user.email}</p>
          </div>
          <button
            onClick={() => setMobileNavOpen(false)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 lg:hidden"
            aria-label="Close menu"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {stores && stores.length > 1 && (
          <div className="border-b border-neutral-100 p-3">
            <label className="mb-1 block text-xs font-medium text-neutral-400">Store</label>
            <select
              className="h-8 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-2 text-xs"
              value={activeStoreId ?? ""}
              onChange={(e) => setActiveStoreId(e.target.value)}
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {visibleNav.map((item) => {
            const active = item.href === activeHref;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-[#FDECEC] font-medium text-[#E5484D]"
                    : "text-neutral-600 hover:bg-neutral-50"
                )}
              >
                <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-[#E5484D]" : "text-neutral-400")} />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-neutral-100 p-2">
          <button
            onClick={() => {
              logout();
              router.replace("/login");
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-neutral-600 hover:bg-neutral-50"
          >
            <LogoutIcon className="h-[18px] w-[18px] text-neutral-400" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
    </div>
  );
}
