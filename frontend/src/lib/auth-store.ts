import { create } from "zustand";

export type RolePermissions = {
  can_refund_or_void: boolean;
  can_manage_staff: boolean;
  can_access_settings: boolean;
  can_manage_menu: boolean;
  can_manage_discounts: boolean;
  can_view_reports: boolean;
};

export type StoreRole = { store_id: string; role: string; permissions: RolePermissions };

export type CurrentUser = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  organization_id: string | null;
  store_roles: StoreRole[];
};

type AuthState = {
  accessToken: string | null;
  refreshToken: string | null;
  user: CurrentUser | null;
  activeStoreId: string | null;
  setTokens: (access: string, refresh: string) => void;
  setUser: (user: CurrentUser | null) => void;
  setActiveStoreId: (storeId: string | null) => void;
  logout: () => void;
  hydrate: () => void;
};

const ACCESS_KEY = "pos_access_token";
const REFRESH_KEY = "pos_refresh_token";
const STORE_KEY = "pos_active_store_id";

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  refreshToken: null,
  user: null,
  activeStoreId: null,

  setTokens: (access, refresh) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(ACCESS_KEY, access);
      localStorage.setItem(REFRESH_KEY, refresh);
    }
    set({ accessToken: access, refreshToken: refresh });
  },

  setUser: (user) => set({ user }),

  setActiveStoreId: (storeId) => {
    if (typeof window !== "undefined") {
      if (storeId) localStorage.setItem(STORE_KEY, storeId);
      else localStorage.removeItem(STORE_KEY);
    }
    set({ activeStoreId: storeId });
  },

  logout: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(ACCESS_KEY);
      localStorage.removeItem(REFRESH_KEY);
      localStorage.removeItem(STORE_KEY);
    }
    set({ accessToken: null, refreshToken: null, user: null, activeStoreId: null });
  },

  hydrate: () => {
    if (typeof window === "undefined") return;
    const access = localStorage.getItem(ACCESS_KEY);
    const refresh = localStorage.getItem(REFRESH_KEY);
    const storeId = localStorage.getItem(STORE_KEY);
    set({ accessToken: access, refreshToken: refresh, activeStoreId: storeId });
  },
}));
