import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

import { Store } from "@/lib/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** The store a room's charges/pre-orders can order food from — normally
 * the RESTAURANT-type store parented to the hotel property (plan section
 * 1's split setup), but some businesses run a single combined store that's
 * itself RESTAURANT-typed and also owns the rooms/reservations directly
 * (no separate hotel-property store at all). Falling back to that store
 * itself, instead of requiring the split, means "order food for this
 * room" still works for a one-store restaurant-that-also-rents-rooms
 * setup, not only the two-store hotel+restaurant one. */
export function findRestaurantStoreFor(stores: Store[] | undefined, hotelStoreId: string | null | undefined) {
  if (!stores || !hotelStoreId) return undefined;
  return (
    stores.find((s) => s.store_type === "RESTAURANT" && s.parent_store === hotelStoreId) ??
    stores.find((s) => s.id === hotelStoreId && s.store_type === "RESTAURANT")
  );
}

export function formatCurrency(amount: number | string, currency = "NPR") {
  const value = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-NP", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
  })
    .format(Number.isFinite(value) ? value : 0)
    .replace("NPR", "Rs.");
}

// Menu items have no photo in this system — a deterministic gradient tile
// (hue from the name) stands in for one so the menu grid still reads as a
// grid of dishes, not a wall of text.
export function nameToGradient(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `linear-gradient(135deg, hsl(${hue} 70% 88%), hsl(${(hue + 40) % 360} 70% 78%))`;
}
