"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { CalendarIcon, ClockIcon, XIcon } from "@/components/ui/icons";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { Paginated } from "@/lib/hooks";
import { KitchenTicket, OrderItem } from "@/lib/types";
import { cn } from "@/lib/utils";

const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_BASE_URL ?? "ws://localhost:8000";

const NEXT_STATUS: Record<string, string | null> = {
  NEW: "COOKING",
  COOKING: "READY",
  READY: "SERVED",
  SERVED: null,
};

const STATUS_STYLE: Record<string, { label: string; badge: string; border: string }> = {
  NEW: { label: "New", badge: "bg-neutral-100 text-neutral-600", border: "border-l-neutral-400" },
  COOKING: { label: "Cooking", badge: "bg-amber-100 text-amber-700", border: "border-l-amber-500" },
  READY: { label: "Ready", badge: "bg-sky-100 text-sky-700", border: "border-l-sky-500" },
  SERVED: { label: "Served", badge: "bg-emerald-100 text-emerald-700", border: "border-l-emerald-500" },
};

// Same order-type language as the POS cart (order-type tabs, "Saved
// Orders" strip) — a kitchen ticket is easiest to call out by table or
// order type, not by station name (every ticket on a single-station
// kitchen would otherwise show the identical title).
const ORDER_TYPE_LABEL: Record<string, string> = {
  DINE_IN: "Dining",
  TAKEAWAY: "Take Away",
  DELIVERY: "Delivery",
  ROOM_SERVICE: "Room Service",
};
const ORDER_TYPE_DOT: Record<string, string> = {
  DINE_IN: "bg-[#E5484D]",
  TAKEAWAY: "bg-amber-500",
  DELIVERY: "bg-emerald-500",
  ROOM_SERVICE: "bg-sky-500",
};

function timeAgo(iso: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

function TicketItemRow({
  item,
  onCancel,
  cancelling,
}: {
  item: OrderItem;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const cancelled = item.status === "CANCELLED";
  // Mirrors the backend's cancel_item guard (orders/views.py): already
  // billed items aren't exposed to this screen at all (invoice-linked
  // items don't stop showing up here, but there's no price data on this
  // screen to know that without an extra lookup) — so this only blocks
  // on what the ticket itself already tells us: too far along, or already
  // cancelled.
  const cancellable = !cancelled && item.status !== "READY" && item.status !== "SERVED";

  // Grouped by modifier_group_name (e.g. "Size", "Toppings") so the
  // kitchen can tell at a glance which variant was picked and what's
  // extra — "Large" alone doesn't say if that's the size or a topping.
  const modifiersByGroup = new Map<string, string[]>();
  for (const mod of item.modifiers) {
    const group = mod.modifier_group_name || "Options";
    modifiersByGroup.set(group, [...(modifiersByGroup.get(group) ?? []), mod.modifier_name]);
  }

  return (
    <li className={cn("space-y-1", cancelled && "opacity-50")}>
      <div className="flex items-start justify-between gap-2">
        <span className={cn("text-sm text-neutral-800", cancelled && "line-through")}>
          <span className="font-semibold">{item.quantity}×</span> {item.menu_item_name}
        </span>
        {cancelled ? (
          <span className="shrink-0 text-[11px] font-medium text-red-500">Cancelled</span>
        ) : (
          cancellable &&
          !confirming && (
            <button
              onClick={() => setConfirming(true)}
              aria-label={`Cancel ${item.menu_item_name}`}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-neutral-300 hover:bg-red-50 hover:text-red-500"
            >
              <XIcon className="h-3 w-3" />
            </button>
          )
        )}
      </div>
      {modifiersByGroup.size > 0 && (
        <div className="flex flex-wrap gap-1">
          {[...modifiersByGroup.entries()].map(([group, names]) => (
            <span
              key={group}
              className="rounded-full bg-[#FDECEC] px-2 py-0.5 text-[11px] font-medium text-[#E5484D]"
            >
              {group}: {names.join(", ")}
            </span>
          ))}
        </div>
      )}
      {item.notes && <p className="text-xs italic text-neutral-400">— {item.notes}</p>}
      {confirming && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-2 py-1.5">
          <span className="text-xs text-red-700">Cancel this item?</span>
          <button
            onClick={() => setConfirming(false)}
            className="ml-auto rounded-md px-2 py-0.5 text-xs text-neutral-500 hover:bg-white"
          >
            No
          </button>
          <button
            onClick={onCancel}
            disabled={cancelling}
            className="rounded-md bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {cancelling ? "…" : "Yes"}
          </button>
        </div>
      )}
    </li>
  );
}

/** Local calendar date as YYYY-MM-DD, for both the <input type="date">
 * value and the API's ?date= param — Date#toISOString() would drift to
 * the wrong day near midnight in timezones behind UTC, since it reports
 * the UTC date rather than the local one. */
function toLocalDateInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export default function KdsPage() {
  const storeId = useAuthStore((s) => s.activeStoreId);
  const accessToken = useAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const [tab, setTab] = useState<"pending" | "done">("pending");
  const todayInput = toLocalDateInput(new Date());
  const [dateFilter, setDateFilter] = useState(todayInput);
  const [stationFilter, setStationFilter] = useState("all");

  const { data: tickets } = useQuery<KitchenTicket[]>({
    queryKey: ["kitchen-tickets", storeId, dateFilter],
    queryFn: async () =>
      (
        await api.get<Paginated<KitchenTicket>>("/kitchen-tickets/", {
          params: { store: storeId, date: dateFilter },
        })
      ).data.results,
    enabled: !!storeId,
  });

  // Live push from the backend (see realtime.consumers.KDSConsumer) keeps
  // this screen current without polling — falls back to whatever the last
  // fetch showed if the socket drops, since the query above still runs.
  // Invalidating the bare ["kitchen-tickets", storeId] prefix still hits
  // every dateFilter variant cached under it (TanStack Query matches by
  // prefix, not exact key, unless told otherwise).
  useEffect(() => {
    if (!storeId || !accessToken) return;
    const socket = new WebSocket(`${WS_BASE_URL}/ws/kds/${storeId}/?token=${accessToken}`);
    wsRef.current = socket;
    socket.onmessage = () => {
      queryClient.invalidateQueries({ queryKey: ["kitchen-tickets", storeId] });
    };
    return () => socket.close();
  }, [storeId, accessToken, queryClient]);

  // Stations are freeform text on MenuItem, not a fixed list anywhere —
  // derived from whatever tickets this date filter actually returned,
  // narrowed further by stationFilter client-side rather than as a
  // second server round-trip.
  const stations = Array.from(new Set((tickets ?? []).map((t) => t.kitchen_station))).sort();
  const dateFilteredTickets =
    stationFilter === "all"
      ? (tickets ?? [])
      : (tickets ?? []).filter((t) => t.kitchen_station === stationFilter);

  const advanceTicket = useMutation({
    mutationFn: async (ticket: KitchenTicket) => {
      const nextStatus = NEXT_STATUS[ticket.status];
      if (!nextStatus) return;
      // Cancelled items are excluded from the ticket's own status ranking
      // server-side (KitchenTicket.refresh_status) — advancing the whole
      // ticket shouldn't try to un-cancel them by bumping their status too.
      const activeItems = ticket.ticket_items.filter((ti) => ti.order_item.status !== "CANCELLED");
      await Promise.all(
        activeItems.map((ti) =>
          api.patch(`/kitchen-tickets/${ticket.id}/items/${ti.order_item.id}/status/`, {
            status: nextStatus,
          })
        )
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kitchen-tickets", storeId] }),
  });

  const cancelItem = useMutation({
    mutationFn: async ({ ticketId, itemId }: { ticketId: string; itemId: string }) =>
      api.post(`/kitchen-tickets/${ticketId}/items/${itemId}/cancel/`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kitchen-tickets", storeId] }),
    onError: (err: unknown) => {
      const data = (err as { response?: { data?: unknown } })?.response?.data;
      const message = Array.isArray(data) ? data[0] : undefined;
      window.alert(message ?? "Could not cancel this item.");
    },
  });

  const pendingTickets = dateFilteredTickets.filter((t) => t.status !== "SERVED");
  const doneTickets = dateFilteredTickets.filter((t) => t.status === "SERVED");
  const shownTickets = tab === "pending" ? pendingTickets : doneTickets;
  const isToday = dateFilter === todayInput;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-neutral-900">Kitchen</h1>
          {isToday && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              live
            </span>
          )}
        </div>

        <div className="flex rounded-xl bg-neutral-100 p-1 text-sm font-medium">
          <button
            onClick={() => setTab("pending")}
            className={cn(
              "rounded-lg px-4 py-1.5 transition-colors",
              tab === "pending" ? "bg-white text-[#E5484D] shadow-sm" : "text-neutral-500 hover:text-neutral-700"
            )}
          >
            Pending ({pendingTickets.length})
          </button>
          <button
            onClick={() => setTab("done")}
            className={cn(
              "rounded-lg px-4 py-1.5 transition-colors",
              tab === "done" ? "bg-white text-[#E5484D] shadow-sm" : "text-neutral-500 hover:text-neutral-700"
            )}
          >
            Done ({doneTickets.length})
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <CalendarIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="date"
            value={dateFilter}
            max={todayInput}
            onChange={(e) => setDateFilter(e.target.value || todayInput)}
            className="h-9 rounded-lg border border-neutral-200 bg-white pl-8 pr-2.5 text-sm text-neutral-700 outline-none focus:border-[#E5484D]"
          />
        </div>
        {!isToday && (
          <button
            onClick={() => setDateFilter(todayInput)}
            className="rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-200"
          >
            Today
          </button>
        )}
        {stations.length > 1 && (
          <select
            value={stationFilter}
            onChange={(e) => setStationFilter(e.target.value)}
            className="h-9 rounded-lg border border-neutral-200 bg-white px-2.5 text-sm text-neutral-700 outline-none focus:border-[#E5484D]"
          >
            <option value="all">All stations</option>
            {stations.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {shownTickets.map((ticket) => {
          const style = STATUS_STYLE[ticket.status];
          const nextStatus = NEXT_STATUS[ticket.status];
          const title = ticket.table_name
            ? `Table ${ticket.table_name}`
            : ORDER_TYPE_LABEL[ticket.order_type] ?? ticket.order_type;
          return (
            <div
              key={ticket.id}
              className={cn(
                "space-y-3 rounded-2xl border border-neutral-200 border-l-4 bg-white p-4 shadow-sm transition-shadow hover:shadow-md",
                style.border
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", ORDER_TYPE_DOT[ticket.order_type])} />
                    <p className="text-sm font-semibold leading-tight text-neutral-900">{title}</p>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-xs text-neutral-400">
                    <ClockIcon className="h-3 w-3 shrink-0" />
                    <span>{timeAgo(ticket.created_at)}</span>
                    {stations.length > 1 && (
                      <>
                        <span>·</span>
                        <span className="truncate">{ticket.kitchen_station}</span>
                      </>
                    )}
                  </div>
                </div>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", style.badge)}>
                  {style.label}
                </span>
              </div>

              <ul className="space-y-2 border-t border-neutral-100 pt-2">
                {ticket.ticket_items.map((ti) => (
                  <TicketItemRow
                    key={ti.id}
                    item={ti.order_item}
                    cancelling={
                      cancelItem.isPending &&
                      cancelItem.variables?.itemId === ti.order_item.id
                    }
                    onCancel={() => cancelItem.mutate({ ticketId: ticket.id, itemId: ti.order_item.id })}
                  />
                ))}
              </ul>

              {nextStatus && (
                <button
                  onClick={() => advanceTicket.mutate(ticket)}
                  disabled={advanceTicket.isPending}
                  className="w-full rounded-xl bg-[#E5484D] py-2 text-sm font-medium text-white hover:bg-[#D6393E] disabled:opacity-60"
                >
                  Mark {STATUS_STYLE[nextStatus].label}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {shownTickets.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-neutral-200 py-14 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
            <ClockIcon className="h-5 w-5" />
          </div>
          <p className="text-sm text-neutral-500">
            {tab === "pending"
              ? isToday
                ? "No pending tickets."
                : "No pending tickets on this date."
              : isToday
                ? "No served tickets yet."
                : "No served tickets on this date."}
          </p>
        </div>
      )}
    </div>
  );
}
