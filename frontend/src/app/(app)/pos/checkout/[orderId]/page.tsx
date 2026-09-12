"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InvoiceCard } from "@/components/invoice-card";
import { Label, Select } from "@/components/ui/input";
import { api } from "@/lib/api";
import { Paginated } from "@/lib/hooks";
import { GuestStay, InvoiceT, MenuItem, OrderItem, OrderT } from "@/lib/types";
import { cn, formatCurrency } from "@/lib/utils";

function itemTotal(item: OrderItem) {
  const modTotal = item.modifiers.reduce((sum, m) => sum + parseFloat(m.price_delta), 0);
  return (parseFloat(item.unit_price) + modTotal) * parseFloat(item.quantity);
}

export default function CheckoutScreen() {
  const { orderId } = useParams<{ orderId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [guestStayId, setGuestStayId] = useState("");

  const { data: order } = useQuery<OrderT>({
    queryKey: ["order", orderId],
    queryFn: async () => (await api.get(`/orders/${orderId}/`)).data,
  });

  // A split-billed order can have more than one Invoice (see plan Phase 2:
  // Order.bill(item_ids=...)) — this is a list, not a single lookup.
  const { data: invoices } = useQuery<InvoiceT[]>({
    queryKey: ["invoices-for-order", orderId],
    queryFn: async () =>
      (await api.get<Paginated<InvoiceT>>("/invoices/", { params: { order: orderId } })).data
        .results,
  });

  const { data: menuItems } = useQuery<MenuItem[]>({
    queryKey: ["menu-items", order?.store],
    queryFn: async () =>
      (await api.get<Paginated<MenuItem>>("/menu-items/", { params: { store: order!.store } }))
        .data.results,
    enabled: !!order?.store,
  });
  const menuItemName = (id: string) => menuItems?.find((m) => m.id === id)?.name ?? "Item";

  const { data: inHouseStays } = useQuery<GuestStay[]>({
    queryKey: ["guest-stays", "in-house"],
    queryFn: async () =>
      (await api.get<Paginated<GuestStay>>("/guest-stays/", { params: { status: "IN_HOUSE" } }))
        .data.results,
  });

  function invalidateAfterBillingChange() {
    queryClient.invalidateQueries({ queryKey: ["order", orderId] });
    queryClient.invalidateQueries({ queryKey: ["invoices-for-order", orderId] });
  }

  const bill = useMutation({
    mutationFn: async (itemIds: string[]) =>
      (await api.post<InvoiceT>(`/orders/${orderId}/bill/`, { item_ids: itemIds })).data,
    onSuccess: () => {
      setSelectedItemIds([]);
      invalidateAfterBillingChange();
    },
  });

  // Releasing the table only makes sense once the whole order is settled —
  // with split billing there can be unpaid invoices left after any single
  // finalize, so this re-checks the order fresh rather than assuming.
  async function releaseTableIfOrderSettled() {
    if (!order?.table) return;
    const { data: freshOrder } = await api.get<OrderT>(`/orders/${orderId}/`);
    if (freshOrder.status === "BILLED" || freshOrder.status === "CHARGED_TO_ROOM") {
      await api.patch(`/tables/${order.table}/status/`, { status: "AVAILABLE" });
      queryClient.invalidateQueries({ queryKey: ["tables"] });
      queryClient.invalidateQueries({ queryKey: ["open-orders-by-table"] });
    }
  }

  const chargeToRoom = useMutation({
    mutationFn: async () => api.post(`/orders/${orderId}/charge-to-room/`, { guest_stay_id: guestStayId }),
    onSuccess: async () => {
      await releaseTableIfOrderSettled();
      router.push("/pos/tables");
    },
  });

  if (!order) return <p className="text-sm text-neutral-500">Loading…</p>;

  const unbilledItems = order.items.filter((item) => !item.invoice);
  const orderSettled = order.status === "BILLED" || order.status === "CHARGED_TO_ROOM";

  function toggleItem(id: string) {
    setSelectedItemIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Checkout</h1>
        <Badge tone="blue">{order.status.replace(/_/g, " ")}</Badge>
      </div>

      {invoices?.map((invoice) => (
        <InvoiceCard
          key={invoice.id}
          invoice={invoice}
          onChanged={() => {
            queryClient.invalidateQueries({ queryKey: ["invoices-for-order", orderId] });
            queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
          }}
          onFinalized={releaseTableIfOrderSettled}
        />
      ))}

      {unbilledItems.length > 0 && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm font-medium">
              {invoices && invoices.length > 0 ? "Remaining items" : "Bill this order"}
            </p>
            <div className="space-y-1">
              {unbilledItems.map((item) => (
                <label
                  key={item.id}
                  className={cn(
                    "flex items-center justify-between rounded-md border px-3 py-2 text-sm",
                    selectedItemIds.includes(item.id) ? "border-neutral-900" : "border-neutral-200"
                  )}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedItemIds.includes(item.id)}
                      onChange={() => toggleItem(item.id)}
                    />
                    {menuItemName(item.menu_item)} × {item.quantity}
                  </span>
                  <span>{formatCurrency(itemTotal(item))}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                variant="secondary"
                disabled={selectedItemIds.length === 0 || bill.isPending}
                onClick={() => bill.mutate(selectedItemIds)}
              >
                Bill selected ({selectedItemIds.length})
              </Button>
              <Button
                className="flex-1"
                onClick={() => bill.mutate(unbilledItems.map((i) => i.id))}
                disabled={bill.isPending}
              >
                Bill all remaining
              </Button>
            </div>

            {order.order_type === "ROOM_SERVICE" && (
              <div className="space-y-2 border-t border-neutral-200 pt-4">
                <Label>Or charge remaining items to room (in-house guest)</Label>
                <Select value={guestStayId} onChange={(e) => setGuestStayId(e.target.value)}>
                  <option value="">Select guest stay…</option>
                  {inHouseStays?.map((stay) => (
                    <option key={stay.id} value={stay.id}>
                      Room stay {stay.id.slice(0, 8)}
                    </option>
                  ))}
                </Select>
                <Button
                  className="w-full"
                  variant="secondary"
                  disabled={!guestStayId || chargeToRoom.isPending}
                  onClick={() => chargeToRoom.mutate()}
                >
                  Charge to room
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {orderSettled && unbilledItems.length === 0 && (
        <Button className="w-full" onClick={() => router.push("/pos/tables")}>
          Done
        </Button>
      )}
    </div>
  );
}
