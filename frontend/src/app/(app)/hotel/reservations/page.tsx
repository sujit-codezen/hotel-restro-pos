"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  CalendarIcon,
  ClockIcon,
  DoorIcon,
  EditIcon,
  PlusIcon,
  ReceiptIcon,
  TrashIcon,
  UsersIcon,
  UtensilsIcon,
  XIcon,
} from "@/components/ui/icons";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { findOrCreateCustomer } from "@/lib/customers";
import { Paginated, useStores } from "@/lib/hooks";
import { GuestStay, MenuItem, Reservation, ReservationStatus, Room, RoomType } from "@/lib/types";
import { cn, findRestaurantStoreFor, formatCurrency } from "@/lib/utils";

const STATUS_STYLE: Record<ReservationStatus, { label: string; pill: string; dot: string }> = {
  BOOKED: { label: "Booked", pill: "bg-sky-50 text-sky-700", dot: "bg-sky-500" },
  CHECKED_IN: { label: "Checked in", pill: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  CHECKED_OUT: { label: "Checked out", pill: "bg-neutral-100 text-neutral-600", dot: "bg-neutral-400" },
  CANCELLED: { label: "Cancelled", pill: "bg-red-50 text-red-600", dot: "bg-red-400" },
  NO_SHOW: { label: "No-show", pill: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
};

// A reservation still holds its room ("active") vs. one that no longer
// does ("inactive") — mirrors Reservation.ACTIVE_STATUSES/INACTIVE_STATUSES
// on the backend.
const ACTIVE_STATUSES: ReservationStatus[] = ["BOOKED", "CHECKED_IN"];
const INACTIVE_STATUSES: ReservationStatus[] = ["CHECKED_OUT", "CANCELLED", "NO_SHOW"];

const AVATAR_PALETTE = [
  "bg-gradient-to-br from-rose-400 to-[#E5484D]",
  "bg-gradient-to-br from-amber-400 to-orange-500",
  "bg-gradient-to-br from-sky-400 to-blue-500",
  "bg-gradient-to-br from-violet-400 to-purple-500",
  "bg-gradient-to-br from-emerald-400 to-teal-500",
];

function hashToIndex(value: string, mod: number) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) % 1000003;
  return hash % mod;
}

function nights(checkIn: string, checkOut: string) {
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
}

function errorMessage(err: unknown, fallback: string) {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (Array.isArray(data)) return data[0] ?? fallback;
  if (data && typeof data === "object") {
    if ("detail" in data && (data as { detail?: string }).detail) {
      return (data as { detail: string }).detail;
    }
    const firstArray = Object.values(data as Record<string, unknown>)[0];
    if (Array.isArray(firstArray)) return firstArray[0] ?? fallback;
  }
  return fallback;
}

type ReservationFormValues = {
  guestPhone: string;
  guestName: string;
  roomTypeId: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  rate: string;
};

/** Popup for creating a new reservation — guest lookup/creation by phone,
 * room type + optional room (assignable later, required only at check-in),
 * stay dates, party size, and a rate pre-filled from the room type. */
function NewReservationModal({
  storeId,
  roomTypes,
  onClose,
  onSubmit,
  submitting,
  error,
}: {
  storeId: string | null;
  roomTypes: RoomType[];
  onClose: () => void;
  onSubmit: (values: ReservationFormValues) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [guestPhone, setGuestPhone] = useState("");
  const [guestName, setGuestName] = useState("");
  const [roomTypeId, setRoomTypeId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [rate, setRate] = useState("");

  const { data: availableRooms } = useQuery<Room[]>({
    queryKey: ["rooms", storeId, "available", roomTypeId],
    queryFn: async () =>
      (
        await api.get<Paginated<Room>>("/rooms/", {
          params: { store: storeId, status: "AVAILABLE", room_type: roomTypeId },
        })
      ).data.results,
    enabled: !!storeId && !!roomTypeId,
  });

  const valid = guestPhone.trim() && roomTypeId && checkIn && checkOut && rate.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md animate-[fadeIn_0.15s_ease-out] rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-neutral-100 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FDECEC] text-[#E5484D]">
            <CalendarIcon className="h-5 w-5" />
          </span>
          <p className="flex-1 font-semibold text-neutral-900">New reservation</p>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
            aria-label="Close"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-400">Guest phone</label>
              <input
                autoFocus
                placeholder="98XXXXXXXX"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-400">Guest name</label>
              <input
                placeholder="Optional"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">Room type</label>
            <select
              value={roomTypeId}
              onChange={(e) => {
                setRoomTypeId(e.target.value);
                setRoomId("");
                const rt = roomTypes.find((r) => r.id === e.target.value);
                if (rt) setRate(rt.base_rate);
              }}
              className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
            >
              <option value="">Select room type…</option>
              {roomTypes.map((rt) => (
                <option key={rt.id} value={rt.id}>
                  {rt.name} — {formatCurrency(rt.base_rate)}/night
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">
              Room <span className="text-neutral-300">(optional now, required to check in)</span>
            </label>
            <select
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              disabled={!roomTypeId}
              className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D] disabled:bg-neutral-50 disabled:text-neutral-400"
            >
              <option value="">Assign later…</option>
              {availableRooms?.map((r) => (
                <option key={r.id} value={r.id}>
                  Room {r.number}
                </option>
              ))}
            </select>
            {roomTypeId && availableRooms?.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">No available rooms of this type right now.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-400">Check-in</label>
              <input
                type="date"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
                className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-400">Check-out</label>
              <input
                type="date"
                min={checkIn || undefined}
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
                className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-400">Adults</label>
              <div className="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-1.5">
                <button
                  type="button"
                  onClick={() => setAdults((a) => Math.max(1, a - 1))}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
                >
                  −
                </button>
                <span className="w-5 flex-1 text-center text-sm font-medium">{adults}</span>
                <button
                  type="button"
                  onClick={() => setAdults((a) => Math.min(12, a + 1))}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
                >
                  +
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-400">Children</label>
              <div className="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-1.5">
                <button
                  type="button"
                  onClick={() => setChildren((c) => Math.max(0, c - 1))}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
                >
                  −
                </button>
                <span className="w-5 flex-1 text-center text-sm font-medium">{children}</span>
                <button
                  type="button"
                  onClick={() => setChildren((c) => Math.min(12, c + 1))}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">Rate / night</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex gap-2 border-t border-neutral-100 p-4">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-neutral-500 hover:bg-neutral-100"
          >
            Cancel
          </button>
          <button
            onClick={() =>
              valid &&
              onSubmit({ guestPhone, guestName, roomTypeId, roomId, checkIn, checkOut, adults, children, rate })
            }
            disabled={!valid || submitting}
            className="flex-1 rounded-xl bg-[#E5484D] py-2.5 text-sm font-medium text-white hover:bg-[#D6393E] disabled:opacity-60"
          >
            {submitting ? "Creating…" : "Create reservation"}
          </button>
        </div>
      </div>
    </div>
  );
}

type ReservationEditValues = {
  roomTypeId: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  rate: string;
};

/** Adding/removing a pre-ordered food item on a still-BOOKED reservation
 * — there's no folio yet at this point (one only exists from check-in
 * onward), so this is its own small endpoint rather than the Folio's
 * add-charge one; check-in copies these onto the real folio. */
/** Its own dedicated popup rather than a buried section — pre-ordering
 * food is a distinct enough action (a different person on shift, a
 * different moment: the guest calls ahead vs. the front desk booking
 * them in) that it deserves the same top-level visibility as "New
 * reservation" or "Edit", not a scroll-down inside the edit modal. */
function FoodPreorderModal({
  reservation,
  storeId,
  onClose,
}: {
  reservation: Reservation;
  storeId: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: stores } = useStores();
  const [menuItemId, setMenuItemId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const restaurantStore = findRestaurantStoreFor(stores, storeId);

  const { data: menuItems } = useQuery<MenuItem[]>({
    queryKey: ["menu-items", restaurantStore?.id, "active"],
    queryFn: async () =>
      (
        await api.get<Paginated<MenuItem>>("/menu-items/", {
          params: { store: restaurantStore!.id, is_active: true },
        })
      ).data.results,
    enabled: !!restaurantStore,
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["reservations", storeId] });
  }

  const addItem = useMutation({
    mutationFn: async () =>
      api.post(`/reservations/${reservation.id}/food-items/`, { menu_item: menuItemId, quantity }),
    onSuccess: () => {
      setMenuItemId("");
      setQuantity(1);
      setError(null);
      refresh();
    },
    onError: (err: unknown) => setError(errorMessage(err, "Could not add that item.")),
  });

  const removeItem = useMutation({
    mutationFn: async (itemId: string) => api.delete(`/reservations/${reservation.id}/food-items/${itemId}/`),
    onSuccess: refresh,
  });

  const subtotal = reservation.food_items.reduce(
    (sum, i) => sum + parseFloat(i.quantity) * parseFloat(i.unit_price),
    0
  );
  const displayName = reservation.guest_name || reservation.guest_phone;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md animate-[fadeIn_0.15s_ease-out] rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-neutral-100 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FDECEC] text-[#E5484D]">
            <UtensilsIcon className="h-5 w-5" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="truncate font-semibold text-neutral-900">Pre-order food</p>
            <p className="truncate text-xs text-neutral-400">for {displayName}, before check-in</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
            aria-label="Close"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
          {reservation.food_items.length > 0 ? (
            <div className="space-y-1.5">
              {reservation.food_items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded-xl bg-neutral-50 px-3 py-2.5 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-neutral-400 shadow-sm">
                      <UtensilsIcon className="h-3.5 w-3.5" />
                    </span>
                    <span className="truncate text-neutral-700">
                      {item.menu_item_name} <span className="text-neutral-400">×{item.quantity}</span>
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs font-medium text-neutral-500">
                      {formatCurrency(parseFloat(item.quantity) * parseFloat(item.unit_price))}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeItem.mutate(item.id)}
                      disabled={removeItem.isPending}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-neutral-300 hover:bg-white hover:text-red-500 disabled:opacity-50"
                      aria-label={`Remove ${item.menu_item_name}`}
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              <div className="flex justify-between rounded-xl bg-[#FDECEC] px-3 py-2 text-sm font-semibold text-[#E5484D]">
                <span>Food subtotal</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-neutral-200 bg-neutral-50/50 py-8 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-neutral-300 shadow-sm">
                <UtensilsIcon className="h-4 w-4" />
              </span>
              <p className="text-sm font-medium text-neutral-600">No food pre-ordered yet</p>
              <p className="text-xs text-neutral-400">Add a dish below — it'll bill to the room at check-in.</p>
            </div>
          )}

          {restaurantStore ? (
            <div className="space-y-2 border-t border-neutral-100 pt-4">
              <label className="block text-xs font-medium text-neutral-400">Add a dish</label>
              <div className="flex gap-2">
                <select
                  value={menuItemId}
                  onChange={(e) => setMenuItemId(e.target.value)}
                  className="h-10 flex-1 rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
                >
                  <option value="">Select a dish…</option>
                  {menuItems?.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} — {formatCurrency(m.price)}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="h-10 w-16 rounded-xl border border-neutral-200 bg-white px-2 text-sm outline-none focus:border-[#E5484D]"
                />
              </div>
              <button
                type="button"
                onClick={() => menuItemId && addItem.mutate()}
                disabled={!menuItemId || addItem.isPending}
                className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-neutral-900 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                <PlusIcon className="h-4 w-4" /> {addItem.isPending ? "Adding…" : "Add to pre-order"}
              </button>
            </div>
          ) : (
            <p className="border-t border-neutral-100 pt-4 text-xs text-neutral-400">
              No linked restaurant to order from.
            </p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="border-t border-neutral-100 p-4">
          <button
            onClick={onClose}
            className="w-full rounded-xl bg-neutral-100 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-200"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** Editing a Booked reservation — room type/room/dates/party size/rate,
 * plus pre-ordering food for when the guest arrives. Locked to BOOKED:
 * once checked in, the real occupancy is the GuestStay/Room, not this
 * record, so the backend refuses these same fields past that point. */
function EditReservationModal({
  reservation,
  storeId,
  roomTypes,
  onClose,
  onSubmit,
  submitting,
  error,
}: {
  reservation: Reservation;
  storeId: string | null;
  roomTypes: RoomType[];
  onClose: () => void;
  onSubmit: (values: ReservationEditValues) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [roomTypeId, setRoomTypeId] = useState(reservation.room_type);
  const [roomId, setRoomId] = useState(reservation.room ?? "");
  const [checkIn, setCheckIn] = useState(reservation.check_in_date);
  const [checkOut, setCheckOut] = useState(reservation.check_out_date);
  const [adults, setAdults] = useState(reservation.adults);
  const [children, setChildren] = useState(reservation.children);
  const [rate, setRate] = useState(reservation.rate_per_night);

  const { data: availableRooms } = useQuery<Room[]>({
    queryKey: ["rooms", storeId, "available", roomTypeId],
    queryFn: async () =>
      (
        await api.get<Paginated<Room>>("/rooms/", {
          params: { store: storeId, status: "AVAILABLE", room_type: roomTypeId },
        })
      ).data.results,
    enabled: !!storeId && !!roomTypeId,
  });

  const valid = roomTypeId && checkIn && checkOut && rate.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md animate-[fadeIn_0.15s_ease-out] rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-neutral-100 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FDECEC] text-[#E5484D]">
            <CalendarIcon className="h-5 w-5" />
          </span>
          <p className="flex-1 font-semibold text-neutral-900">
            Edit {reservation.guest_name || reservation.guest_phone}&apos;s reservation
          </p>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
            aria-label="Close"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">Room type</label>
            <select
              value={roomTypeId}
              onChange={(e) => {
                setRoomTypeId(e.target.value);
                setRoomId("");
              }}
              className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
            >
              {roomTypes.map((rt) => (
                <option key={rt.id} value={rt.id}>
                  {rt.name} — {formatCurrency(rt.base_rate)}/night
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">Room</label>
            <select
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
            >
              <option value="">Assign later…</option>
              {availableRooms?.map((r) => (
                <option key={r.id} value={r.id}>
                  Room {r.number}
                </option>
              ))}
              {reservation.room && !availableRooms?.some((r) => r.id === reservation.room) && (
                <option value={reservation.room}>Room {reservation.room_number} (current)</option>
              )}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-400">Check-in</label>
              <input
                type="date"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
                className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-400">Check-out</label>
              <input
                type="date"
                min={checkIn || undefined}
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
                className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-400">Adults</label>
              <div className="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-1.5">
                <button
                  type="button"
                  onClick={() => setAdults((a) => Math.max(1, a - 1))}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
                >
                  −
                </button>
                <span className="w-5 flex-1 text-center text-sm font-medium">{adults}</span>
                <button
                  type="button"
                  onClick={() => setAdults((a) => Math.min(12, a + 1))}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
                >
                  +
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-400">Children</label>
              <div className="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-1.5">
                <button
                  type="button"
                  onClick={() => setChildren((c) => Math.max(0, c - 1))}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
                >
                  −
                </button>
                <span className="w-5 flex-1 text-center text-sm font-medium">{children}</span>
                <button
                  type="button"
                  onClick={() => setChildren((c) => Math.min(12, c + 1))}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">Rate / night</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex gap-2 border-t border-neutral-100 p-4">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-neutral-500 hover:bg-neutral-100"
          >
            Cancel
          </button>
          <button
            onClick={() => valid && onSubmit({ roomTypeId, roomId, checkIn, checkOut, adults, children, rate })}
            disabled={!valid || submitting}
            className="flex-1 rounded-xl bg-[#E5484D] py-2.5 text-sm font-medium text-white hover:bg-[#D6393E] disabled:opacity-60"
          >
            {submitting ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReservationCard({
  reservation,
  index,
  onCheckIn,
  checkingIn,
  onCancel,
  cancelling,
  cancelError,
  onEdit,
  onFood,
}: {
  reservation: Reservation;
  index: number;
  onCheckIn: () => void;
  checkingIn: boolean;
  onCancel: () => void;
  cancelling: boolean;
  cancelError: string | null;
  onEdit: () => void;
  onFood: () => void;
}) {
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const style = STATUS_STYLE[reservation.status];
  const displayName = reservation.guest_name || reservation.guest_phone;
  const initial = displayName ? displayName.charAt(0).toUpperCase() : "?";
  const foodCount = reservation.food_items.length;

  return (
    <div className="group rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm",
              AVATAR_PALETTE[hashToIndex(reservation.id, AVATAR_PALETTE.length)]
            )}
          >
            {initial}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-neutral-900">{displayName}</p>
            {reservation.guest_name && (
              <p className="truncate text-xs text-neutral-400">{reservation.guest_phone}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 sm:justify-end">
          <div className="flex items-center gap-1.5 text-sm text-neutral-600">
            <CalendarIcon className="h-4 w-4 text-neutral-300" />
            {reservation.check_in_date} → {reservation.check_out_date}
            <span className="text-xs text-neutral-400">
              ({nights(reservation.check_in_date, reservation.check_out_date)}n)
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-sm text-neutral-600">
            <DoorIcon className="h-4 w-4 text-neutral-300" />
            {reservation.room_type_name}
            {reservation.room_number && (
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                Room {reservation.room_number}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-sm text-neutral-600">
            <UsersIcon className="h-4 w-4 text-neutral-300" />
            {reservation.adults + reservation.children}
          </div>

          <p className="text-sm font-semibold text-neutral-900">
            {formatCurrency(reservation.rate_per_night)}
            <span className="text-xs font-normal text-neutral-400">/night</span>
          </p>

          <span className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", style.pill)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
            {style.label}
          </span>

          {reservation.status === "BOOKED" && !confirmingCancel && (
            <div className="flex items-center gap-2">
              <button
                onClick={onFood}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  foodCount > 0
                    ? "bg-[#FDECEC] text-[#E5484D] hover:bg-[#F9D8D8]"
                    : "text-neutral-500 hover:bg-neutral-100"
                )}
              >
                <UtensilsIcon className="h-3.5 w-3.5" />
                {foodCount > 0 ? `Food (${foodCount})` : "Add food"}
              </button>
              <button
                onClick={onEdit}
                className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
                aria-label="Edit reservation"
              >
                <EditIcon className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setConfirmingCancel(true)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-500 hover:bg-neutral-100"
              >
                Cancel
              </button>
              <button
                onClick={onCheckIn}
                disabled={!reservation.room || checkingIn}
                title={!reservation.room ? "Assign a room to this reservation first" : undefined}
                className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {checkingIn ? "Checking in…" : "Check in"}
              </button>
            </div>
          )}

          {reservation.status === "CHECKED_IN" && reservation.guest_stay_id && (
            <Link
              href={`/hotel/folio/${reservation.guest_stay_id}`}
              className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
            >
              <ReceiptIcon className="h-3.5 w-3.5" /> Food &amp; payment
            </Link>
          )}
        </div>
      </div>

      {reservation.status === "BOOKED" && confirmingCancel && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-red-50 p-3">
          <p className="flex-1 text-xs text-red-700">Cancel this reservation? This can&apos;t be undone.</p>
          {cancelError && <p className="w-full text-xs text-red-600">{cancelError}</p>}
          <button
            onClick={() => setConfirmingCancel(false)}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-white"
          >
            Keep it
          </button>
          <button
            onClick={onCancel}
            disabled={cancelling}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {cancelling ? "Cancelling…" : "Yes, cancel"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function ReservationsPage() {
  const storeId = useAuthStore((s) => s.activeStoreId);
  const router = useRouter();
  const queryClient = useQueryClient();

  const [showNew, setShowNew] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);
  const [lifecycleTab, setLifecycleTab] = useState<"active" | "inactive">("active");
  const [statusFilter, setStatusFilter] = useState<ReservationStatus | null>(null);
  const [cancelErrors, setCancelErrors] = useState<Record<string, string>>({});
  const [editingReservation, setEditingReservation] = useState<Reservation | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [foodReservation, setFoodReservation] = useState<Reservation | null>(null);

  const { data: reservations, isLoading } = useQuery<Reservation[]>({
    queryKey: ["reservations", storeId],
    queryFn: async () =>
      (await api.get<Paginated<Reservation>>("/reservations/", { params: { store: storeId } }))
        .data.results,
    enabled: !!storeId,
  });

  const { data: roomTypes } = useQuery<RoomType[]>({
    queryKey: ["room-types", storeId],
    queryFn: async () =>
      (await api.get<Paginated<RoomType>>("/room-types/", { params: { store: storeId } })).data
        .results,
    enabled: !!storeId,
  });

  const createReservation = useMutation({
    mutationFn: async (values: ReservationFormValues) => {
      const customer = await findOrCreateCustomer(values.guestPhone, values.guestName);
      return api.post("/reservations/", {
        store: storeId,
        guest: customer.id,
        room_type: values.roomTypeId,
        room: values.roomId || null,
        check_in_date: values.checkIn,
        check_out_date: values.checkOut,
        adults: values.adults,
        children: values.children,
        rate_per_night: values.rate,
      });
    },
    onSuccess: () => {
      setShowNew(false);
      setNewError(null);
      queryClient.invalidateQueries({ queryKey: ["reservations", storeId] });
    },
    onError: (err: unknown) =>
      setNewError(errorMessage(err, "Could not create the reservation — check the fields and try again.")),
  });

  const checkIn = useMutation({
    mutationFn: async (reservation: Reservation) =>
      (
        await api.post<GuestStay>(`/reservations/${reservation.id}/check-in/`, {
          room: reservation.room,
        })
      ).data,
    onSuccess: (stay) => {
      queryClient.invalidateQueries({ queryKey: ["reservations", storeId] });
      router.push(`/hotel/folio/${stay.id}`);
    },
  });

  const cancelReservation = useMutation({
    mutationFn: async (reservation: Reservation) => api.post(`/reservations/${reservation.id}/cancel/`),
    onSuccess: (_data, reservation) => {
      setCancelErrors((prev) => {
        const next = { ...prev };
        delete next[reservation.id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["reservations", storeId] });
    },
    onError: (err: unknown, reservation) =>
      setCancelErrors((prev) => ({
        ...prev,
        [reservation.id]: errorMessage(err, "Could not cancel this reservation."),
      })),
  });

  const updateReservation = useMutation({
    mutationFn: async (values: ReservationEditValues) =>
      api.patch(`/reservations/${editingReservation!.id}/`, {
        room_type: values.roomTypeId,
        room: values.roomId || null,
        check_in_date: values.checkIn,
        check_out_date: values.checkOut,
        adults: values.adults,
        children: values.children,
        rate_per_night: values.rate,
      }),
    onSuccess: () => {
      setEditingReservation(null);
      setEditError(null);
      queryClient.invalidateQueries({ queryKey: ["reservations", storeId] });
    },
    onError: (err: unknown) =>
      setEditError(errorMessage(err, "Could not save changes — check the fields and try again.")),
  });

  const counts = (reservations ?? []).reduce(
    (acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }),
    {} as Partial<Record<ReservationStatus, number>>
  );

  const lifecycleStatuses = lifecycleTab === "active" ? ACTIVE_STATUSES : INACTIVE_STATUSES;
  const activeCount = ACTIVE_STATUSES.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
  const inactiveCount = INACTIVE_STATUSES.reduce((sum, s) => sum + (counts[s] ?? 0), 0);

  const byLifecycle = reservations?.filter((r) => lifecycleStatuses.includes(r.status));
  const shown = statusFilter ? byLifecycle?.filter((r) => r.status === statusFilter) : byLifecycle;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Reservations</h1>
          <p className="mt-0.5 text-sm text-neutral-500">Book stays and manage guest check-ins.</p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="flex rounded-xl bg-neutral-100 p-1 text-sm font-medium">
            <button
              onClick={() => {
                setLifecycleTab("active");
                setStatusFilter(null);
              }}
              className={cn(
                "rounded-lg px-4 py-1.5 transition-all",
                lifecycleTab === "active" ? "bg-white text-[#E5484D] shadow-sm" : "text-neutral-500 hover:text-neutral-700"
              )}
            >
              Active ({activeCount})
            </button>
            <button
              onClick={() => {
                setLifecycleTab("inactive");
                setStatusFilter(null);
              }}
              className={cn(
                "rounded-lg px-4 py-1.5 transition-all",
                lifecycleTab === "inactive" ? "bg-white text-[#E5484D] shadow-sm" : "text-neutral-500 hover:text-neutral-700"
              )}
            >
              Inactive ({inactiveCount})
            </button>
          </div>

          <button
            onClick={() => {
              setNewError(null);
              setShowNew(true);
            }}
            disabled={!roomTypes || roomTypes.length === 0}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-[#E5484D] px-4 text-sm font-medium text-white shadow-sm shadow-[#E5484D]/20 transition-all hover:-translate-y-px hover:bg-[#D6393E] hover:shadow-md hover:shadow-[#E5484D]/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PlusIcon className="h-4 w-4" /> New reservation
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {lifecycleStatuses.map((status) => {
          const style = STATUS_STYLE[status];
          const active = statusFilter === status;
          return (
            <button
              key={status}
              onClick={() => setStatusFilter(active ? null : status)}
              className={cn(
                "flex items-center gap-3 rounded-2xl border p-3.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
                active ? "border-[#E5484D] ring-2 ring-[#F5C6C7]" : "border-neutral-200 bg-white"
              )}
            >
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", style.dot)} />
              <div className="min-w-0">
                <p className="text-xl font-semibold leading-none text-neutral-900">{counts[status] ?? 0}</p>
                <p className="mt-1 truncate text-xs font-medium text-neutral-500">{style.label}</p>
              </div>
            </button>
          );
        })}
      </div>

      {showNew && (
        <NewReservationModal
          storeId={storeId}
          roomTypes={roomTypes ?? []}
          onClose={() => setShowNew(false)}
          onSubmit={(values) => createReservation.mutate(values)}
          submitting={createReservation.isPending}
          error={newError}
        />
      )}

      {editingReservation && (
        <EditReservationModal
          reservation={reservations?.find((r) => r.id === editingReservation.id) ?? editingReservation}
          storeId={storeId}
          roomTypes={roomTypes ?? []}
          onClose={() => setEditingReservation(null)}
          onSubmit={(values) => updateReservation.mutate(values)}
          submitting={updateReservation.isPending}
          error={editError}
        />
      )}

      {foodReservation && (
        <FoodPreorderModal
          reservation={reservations?.find((r) => r.id === foodReservation.id) ?? foodReservation}
          storeId={storeId}
          onClose={() => setFoodReservation(null)}
        />
      )}

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-neutral-100" />
          ))}
        </div>
      )}

      {!isLoading && roomTypes?.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/50 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-neutral-300 shadow-sm">
            <DoorIcon className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-medium text-neutral-700">Create a room type first</p>
            <p className="mt-0.5 text-xs text-neutral-400">
              Reservations need a room type before they can be booked.
            </p>
          </div>
          <a
            href="/hotel/rooms"
            className="mt-1 flex items-center gap-1.5 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            <DoorIcon className="h-4 w-4" /> Go to Rooms
          </a>
        </div>
      )}

      {!isLoading && roomTypes && roomTypes.length > 0 && (
        <div className="space-y-3">
          {shown?.map((res, i) => (
            <ReservationCard
              key={res.id}
              reservation={res}
              index={i}
              onCheckIn={() => checkIn.mutate(res)}
              checkingIn={checkIn.isPending && checkIn.variables?.id === res.id}
              onCancel={() => cancelReservation.mutate(res)}
              cancelling={cancelReservation.isPending && cancelReservation.variables?.id === res.id}
              cancelError={cancelErrors[res.id] ?? null}
              onEdit={() => {
                setEditingReservation(res);
                setEditError(null);
              }}
              onFood={() => setFoodReservation(res)}
            />
          ))}

          {shown?.length === 0 && reservations && reservations.length > 0 && (
            <p className="py-6 text-center text-sm text-neutral-500">
              {statusFilter
                ? `No ${STATUS_STYLE[statusFilter].label.toLowerCase()} reservations.`
                : `No ${lifecycleTab} reservations.`}
            </p>
          )}

          {reservations?.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/50 py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-neutral-300 shadow-sm">
                <ClockIcon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-medium text-neutral-700">No reservations yet</p>
                <p className="mt-0.5 text-xs text-neutral-400">Book your first stay to get started.</p>
              </div>
              <button
                onClick={() => {
                  setNewError(null);
                  setShowNew(true);
                }}
                className="mt-1 flex items-center gap-1.5 rounded-xl bg-[#E5484D] px-4 py-2 text-sm font-medium text-white hover:bg-[#D6393E]"
              >
                <PlusIcon className="h-4 w-4" /> New reservation
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
