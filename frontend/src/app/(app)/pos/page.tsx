"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { PosOrderScreen } from "@/components/pos-order-screen";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { Paginated } from "@/lib/hooks";
import { OrderT } from "@/lib/types";

const ORDER_TYPE_LABEL: Record<OrderT["order_type"], string> = {
  DINE_IN: "Dining",
  TAKEAWAY: "Take Away",
  DELIVERY: "Delivery",
  ROOM_SERVICE: "Room Service",
};

/** "POS" in the sidebar used to always spawn a brand-new blank order on
 * every visit — clicking it twice left the first order stranded (HELD,
 * with no table, so invisible on the Tables grid too) while a second
 * empty one silently took its place. The fix: check for saved orders
 * first. If there's nothing to resume, this behaves exactly like before
 * — one click, straight into a fresh order, no extra screen in the way.
 * Only when there's actually something worth choosing from does it stop
 * and show the list instead of silently burying it under a new order —
 * a held order *with* a table already shows on its table's tile in
 * Tables, so only the table-less ones (walk-ins/takeaway/delivery put on
 * hold) need a home here.
 *
 * Deliberately never puts the order's id in the URL (unlike Tables ->
 * /pos/order/[id]) — activeOrderId is local state instead, and
 * PosOrderScreen is rendered right here once it's known. The trade-off:
 * refreshing the page mid-order abandons it (nothing in the URL to
 * resume from) rather than reloading back into it. */
export default function QuickPosEntry() {
  const storeId = useAuthStore((s) => s.activeStoreId);
  const queryClient = useQueryClient();
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const autoStarted = useRef(false);
  // Flips true once, the first time the held-orders fetch settles — after
  // that, a later background refetch (isFetching flipping again) doesn't
  // re-block the screen behind "Starting a new order…" when there's
  // nothing to actually start (the auto-start decision below only ever
  // runs once per "session" at this chooser, gated on this same flag).
  const [settled, setSettled] = useState(false);

  const { data: heldOrders, isFetching } = useQuery<OrderT[]>({
    queryKey: ["untabled-held-orders", storeId],
    queryFn: async () =>
      (
        await api.get<Paginated<OrderT>>("/orders/", {
          params: { store: storeId, status: "HELD" },
        })
      ).data.results.filter((o) => !o.table),
    enabled: !!storeId && !activeOrderId,
  });

  const startOrder = useMutation({
    mutationFn: async () =>
      (await api.post<OrderT>("/orders/", { store: storeId, order_type: "DINE_IN" })).data,
    onSuccess: (order) => setActiveOrderId(order.id),
  });

  const resumeOrder = useMutation({
    mutationFn: async (orderId: string) => api.post(`/orders/${orderId}/resume/`),
    onSuccess: (_data, orderId) => setActiveOrderId(orderId),
  });

  useEffect(() => {
    // isFetching, not just "no data yet" — with staleTime 0 (the default
    // here), a cached [] from a previous visit renders instantly while a
    // background refetch is still in flight; acting on that stale value
    // would auto-start a redundant order right as a just-saved one was
    // about to show up in the real (refetched) list.
    if (isFetching || settled || activeOrderId) return;
    setSettled(true);
    if (heldOrders && heldOrders.length === 0) {
      autoStarted.current = true;
      startOrder.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFetching, heldOrders, settled, activeOrderId]);

  // Back from an embedded order (saved, or nothing left to do) to the
  // chooser — re-run the whole decide-or-list dance against fresh data,
  // same as a first mount would.
  function returnToChooser() {
    setActiveOrderId(null);
    setSettled(false);
    autoStarted.current = false;
    queryClient.invalidateQueries({ queryKey: ["untabled-held-orders", storeId] });
  }

  if (activeOrderId) {
    return (
      <PosOrderScreen
        orderId={activeOrderId}
        onSwitchOrder={setActiveOrderId}
        onDone={() => returnToChooser()}
      />
    );
  }

  if (!storeId || !settled || autoStarted.current) {
    return <p className="text-sm text-neutral-500">Starting a new order…</p>;
  }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">POS</h1>
        <button
          onClick={() => startOrder.mutate()}
          disabled={startOrder.isPending}
          className="rounded-xl bg-[#E5484D] px-4 py-2 text-sm font-medium text-white hover:bg-[#D6393E] disabled:opacity-60"
        >
          {startOrder.isPending ? "Starting…" : "+ New order"}
        </button>
      </div>

      {heldOrders && heldOrders.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-neutral-400">
            Saved orders — pick up where you left off
          </p>
          {heldOrders.map((o) => (
            <button
              key={o.id}
              onClick={() => resumeOrder.mutate(o.id)}
              disabled={resumeOrder.isPending}
              className="flex w-full items-center justify-between rounded-2xl border border-neutral-200 bg-white p-4 text-left shadow-sm transition-shadow hover:border-[#E5484D] hover:shadow-md disabled:opacity-60"
            >
              <div>
                <p className="text-sm font-medium text-neutral-900">
                  {ORDER_TYPE_LABEL[o.order_type]} — {o.items.length} item
                  {o.items.length !== 1 ? "s" : ""}
                </p>
                <p className="text-xs text-neutral-400">
                  {/* Order.created_at, not a separate "held at" timestamp
                      — the model doesn't track one — so this is when the
                      order was started, not necessarily when it was saved. */}
                  Started {new Date(o.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
              <span className="shrink-0 text-xs font-medium text-[#E5484D]">Resume →</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-neutral-500">No saved orders — start a new one.</p>
      )}
    </div>
  );
}
