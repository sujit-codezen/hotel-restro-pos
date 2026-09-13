"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { IconInput } from "@/components/ui/icon-input";
import { MinusIcon, PlusIcon, SearchIcon, TrashIcon } from "@/components/ui/icons";
import { api } from "@/lib/api";
import { findOrCreateCustomer } from "@/lib/customers";
import { Paginated } from "@/lib/hooks";
import { Customer, InvoiceT, MenuCategory, MenuItem, ModifierGroup, OrderT, PosTable } from "@/lib/types";
import { cn, formatCurrency, nameToGradient } from "@/lib/utils";

const ORDER_TYPE_TABS: { value: OrderT["order_type"]; label: string }[] = [
  { value: "DINE_IN", label: "Dining" },
  { value: "TAKEAWAY", label: "Take Away" },
  { value: "DELIVERY", label: "Delivery" },
];

type TaxClass = { id: string; rate_percent: string; is_inclusive: boolean };

const PAYMENT_CHIPS: { value: string; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "QR", label: "QR Code" },
];

const ORDER_TYPE_TONE: Record<OrderT["order_type"], string> = {
  DINE_IN: "text-[#E5484D]",
  TAKEAWAY: "text-amber-600",
  DELIVERY: "text-emerald-600",
  ROOM_SERVICE: "text-sky-600",
};

type PosOrderScreenProps = {
  orderId: string;
  /** Switch to showing a different order — e.g. resuming a sibling saved
   * order from the "Saved Orders" strip. The routed page (/pos/order/[id])
   * does this by navigating to that order's own URL; the POS quick-entry
   * page (/pos) does it by swapping local state instead, since it never
   * puts the order id in the URL at all. */
  onSwitchOrder: (newOrderId: string) => void;
  /** Called after the order is saved/held — "go back to wherever picking
   * up ordering again would start from." The routed page sends you to
   * Tables (dine-in) or /pos (table-less); the quick-entry page just
   * drops back to its own chooser. */
  onDone: (info: { hasTable: boolean }) => void;
  /** Set when this screen is embedded on a room's Folio page, building a
   * ROOM_SERVICE order for that stay — settles by posting straight to the
   * guest's folio instead of the normal bill/pay/checkout flow, since
   * charge-to-room has no payment step of its own (the folio settles
   * once, at checkout). Swaps "Generate Bill" for "Charge to room" and
   * hides the quick-pay chips, which don't apply here. */
  chargeToRoom?: { guestStayId: string; onCharged: () => void };
};

export function PosOrderScreen({ orderId, onSwitchOrder, onDone, chargeToRoom }: PosOrderScreenProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pickerItem, setPickerItem] = useState<MenuItem | null>(null);
  const [selectedModifiers, setSelectedModifiers] = useState<string[]>([]);
  const [pickerQuantity, setPickerQuantity] = useState(1);
  const [pickerNotes, setPickerNotes] = useState("");
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | "ALL">("ALL");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);

  // Embedded mode (POS quick-entry) can swap orderId without unmounting
  // this component — close any in-progress item picker rather than
  // carrying a stale modifier selection over to the new order's context.
  useEffect(() => {
    setPickerItem(null);
    setSelectedModifiers([]);
    setPickerQuantity(1);
    setPickerNotes("");
  }, [orderId]);

  const { data: order, isLoading } = useQuery<OrderT>({
    queryKey: ["order", orderId],
    queryFn: async () => (await api.get(`/orders/${orderId}/`)).data,
    refetchInterval: 5_000,
  });

  // Scoped to the ORDER's own store, not the sidebar's globally-selected
  // store — a room-service order is created against the restaurant store
  // while the cashier may still have the hotel property store selected, so
  // using the global selector here would show an empty (wrong-store) menu.
  const storeId = order?.store;
  const cartLocked = !!order && order.status !== "OPEN" && order.status !== "HELD";
  // Settled = paid/charged/cancelled — nothing about this order changes
  // anymore. Distinct from cartLocked (order-type/table, still frozen
  // once anything's shipped to the kitchen): a table ordering a second
  // round after the first already went to the kitchen is normal, so
  // adding more items — and editing/removing ones that haven't been
  // sent yet — stays open right up until the order is actually settled.
  const orderSettled =
    !!order && ["BILLED", "CHARGED_TO_ROOM", "CANCELLED"].includes(order.status);
  const hasUnsentItems = !!order?.items.some((i) => !i.sent_to_kitchen);

  const { data: menuItems } = useQuery<MenuItem[]>({
    queryKey: ["menu-items", storeId],
    queryFn: async () =>
      (
        await api.get<Paginated<MenuItem>>("/menu-items/", {
          params: { store: storeId, is_active: true },
        })
      ).data.results,
    enabled: !!storeId,
  });
  const menuItemName = (id: string) => menuItems?.find((m) => m.id === id)?.name ?? "Item";
  const menuItemImage = (id: string) => menuItems?.find((m) => m.id === id)?.image ?? null;

  const { data: categories } = useQuery<MenuCategory[]>({
    queryKey: ["menu-categories", storeId],
    queryFn: async () =>
      (
        await api.get<Paginated<MenuCategory>>("/menu-categories/", {
          params: { store: storeId },
        })
      ).data.results,
    enabled: !!storeId,
  });

  // Org-wide, not store-scoped (TaxClass has no store field) — used only
  // to preview the tax this order will owe. The real number is computed
  // server-side at bill() time (orders/models.py's Order._describe_item),
  // this just mirrors that same exclusive-tax formula for display.
  const { data: taxClasses } = useQuery<TaxClass[]>({
    queryKey: ["tax-classes"],
    queryFn: async () => (await api.get<Paginated<TaxClass>>("/tax-classes/")).data.results,
  });
  const taxClassById = new Map((taxClasses ?? []).map((t) => [t.id, t]));

  // Tables this order could be assigned to: any AVAILABLE one, plus
  // whichever table it's already sitting at (so that one still shows as
  // the selected option even though its own status is OCCUPIED).
  const { data: tables } = useQuery<PosTable[]>({
    queryKey: ["tables", storeId],
    queryFn: async () =>
      (await api.get<Paginated<PosTable>>("/tables/", { params: { store: storeId } })).data
        .results,
    enabled: !!storeId && order?.order_type === "DINE_IN",
  });
  const assignableTables = (tables ?? []).filter(
    (t) => t.status === "AVAILABLE" || t.id === order?.table
  );

  // Other tabs/orders can be building a bill in parallel — a "Saved Orders"
  // strip so the cashier can jump between them without going back through
  // the table grid every time.
  const { data: heldOrders } = useQuery<OrderT[]>({
    queryKey: ["held-orders", storeId],
    queryFn: async () =>
      (
        await api.get<Paginated<OrderT>>("/orders/", {
          params: { store: storeId, status: "HELD" },
        })
      ).data.results,
    enabled: !!storeId,
    refetchInterval: 10_000,
  });

  const { data: attachedCustomer } = useQuery<Customer>({
    queryKey: ["customer", order?.customer],
    queryFn: async () => (await api.get<Customer>(`/customers/${order!.customer}/`)).data,
    enabled: !!order?.customer,
  });

  function invalidateOrderAndTables() {
    queryClient.invalidateQueries({ queryKey: ["order", orderId] });
    queryClient.invalidateQueries({ queryKey: ["tables", storeId] });
    queryClient.invalidateQueries({ queryKey: ["open-orders-by-table", storeId] });
  }

  const attachCustomer = useMutation({
    mutationFn: async () => {
      const customer = await findOrCreateCustomer(customerPhone, customerName);
      return api.patch(`/orders/${orderId}/`, { customer: customer.id });
    },
    onSuccess: () => {
      setCustomerPhone("");
      setCustomerName("");
      queryClient.invalidateQueries({ queryKey: ["order", orderId] });
    },
  });

  const changeOrderType = useMutation({
    mutationFn: async (newType: OrderT["order_type"]) => {
      const payload: Record<string, unknown> = { order_type: newType };
      // Table only makes sense for dine-in — switching away from it frees
      // whatever table this order held.
      if (newType !== "DINE_IN") payload.table = null;
      await api.patch(`/orders/${orderId}/`, payload);
      if (newType !== "DINE_IN" && order?.table) {
        await api.patch(`/tables/${order.table}/status/`, { status: "AVAILABLE" });
      }
    },
    onSuccess: invalidateOrderAndTables,
  });

  const changeTable = useMutation({
    mutationFn: async (newTableId: string) => {
      const previousTable = order?.table;
      await api.patch(`/orders/${orderId}/`, { table: newTableId });
      await api.patch(`/tables/${newTableId}/status/`, { status: "OCCUPIED" });
      if (previousTable && previousTable !== newTableId) {
        await api.patch(`/tables/${previousTable}/status/`, { status: "AVAILABLE" });
      }
    },
    onSuccess: invalidateOrderAndTables,
  });

  const addItem = useMutation({
    mutationFn: async ({
      item,
      modifiers,
      quantity,
      notes,
    }: {
      item: MenuItem;
      modifiers: string[];
      quantity: number;
      notes?: string;
    }) =>
      api.post(`/orders/${orderId}/items/`, {
        menu_item: item.id,
        quantity,
        modifiers,
        notes: notes ?? "",
      }),
    onSuccess: () => {
      setPickerItem(null);
      setSelectedModifiers([]);
      setPickerQuantity(1);
      setPickerNotes("");
      queryClient.invalidateQueries({ queryKey: ["order", orderId] });
    },
  });

  const setItemQuantity = useMutation({
    mutationFn: async ({ itemId, quantity }: { itemId: string; quantity: number }) =>
      api.patch(`/orders/${orderId}/items/${itemId}/`, { quantity }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["order", orderId] }),
  });

  const removeItem = useMutation({
    mutationFn: async (itemId: string) => api.delete(`/orders/${orderId}/items/${itemId}/`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["order", orderId] }),
  });

  const sendToKitchen = useMutation({
    mutationFn: async () => api.post(`/orders/${orderId}/send-to-kitchen/`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["order", orderId] }),
    onError: (err: unknown) => {
      const data = (err as { response?: { data?: unknown } })?.response?.data;
      const message = Array.isArray(data) ? data[0] : undefined;
      window.alert(message ?? "Could not send to kitchen.");
    },
  });

  const hold = useMutation({
    mutationFn: async () => api.post(`/orders/${orderId}/hold/`),
    onSuccess: () => onDone({ hasTable: !!order?.table }),
  });

  const resumeHeldOrder = useMutation({
    mutationFn: async (heldOrderId: string) => api.post(`/orders/${heldOrderId}/resume/`),
    onSuccess: (_data, heldOrderId) => onSwitchOrder(heldOrderId),
  });

  function handleItemClick(item: MenuItem) {
    if (item.modifier_groups.length === 0) {
      addItem.mutate({ item, modifiers: [], quantity: 1 });
    } else {
      setPickerItem(item);
      // Required single-choice groups (e.g. Size) start with their first
      // option picked, rather than leaving the cashier able to add the
      // item with no size chosen at all.
      setSelectedModifiers(
        item.modifier_groups
          .filter((g) => g.is_required && g.selection_type === "SINGLE" && g.modifiers[0])
          .map((g) => g.modifiers[0].id)
      );
      setPickerQuantity(1);
      setPickerNotes("");
    }
  }

  function toggleModifier(group: ModifierGroup, modifierId: string) {
    setSelectedModifiers((prev) => {
      const otherGroupIds = pickerItem
        ? new Set(pickerItem.modifier_groups.filter((g) => g.id !== group.id).flatMap((g) => g.modifiers.map((m) => m.id)))
        : new Set<string>();
      const keep = prev.filter((id) => otherGroupIds.has(id));
      if (group.selection_type === "SINGLE") {
        return [...keep, modifierId];
      }
      const alreadyIn = prev.includes(modifierId);
      const thisGroupSelected = prev.filter((id) => group.modifiers.some((m) => m.id === id));
      return [
        ...keep,
        ...(alreadyIn
          ? thisGroupSelected.filter((id) => id !== modifierId)
          : [...thisGroupSelected, modifierId]),
      ];
    });
  }

  const pickerModifierTotal = pickerItem
    ? pickerItem.modifier_groups
        .flatMap((g) => g.modifiers)
        .filter((m) => selectedModifiers.includes(m.id))
        .reduce((sum, m) => sum + parseFloat(m.price_delta), 0)
    : 0;
  const pickerUnitPrice = (pickerItem ? parseFloat(pickerItem.price) : 0) + pickerModifierTotal;
  const pickerLineTotal = pickerUnitPrice * pickerQuantity;

  // Quantity already in the cart for this menu item, aggregated across
  // however many OrderItem rows share it (e.g. one added plain, one with
  // different modifiers) — purely for the "N in cart" badge on the tile.
  function cartQuantityFor(menuItemId: string) {
    return (order?.items ?? [])
      .filter((i) => i.menu_item === menuItemId)
      .reduce((sum, i) => sum + parseFloat(i.quantity), 0);
  }

  const filteredItems = (menuItems ?? []).filter((item) => {
    const matchesCategory = activeCategory === "ALL" || item.category === activeCategory;
    const matchesSearch = item.name.toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const subtotal =
    order?.items.reduce((sum, i) => {
      const modTotal = i.modifiers.reduce((m, mm) => m + parseFloat(mm.price_delta), 0);
      return sum + (parseFloat(i.unit_price) + modTotal) * parseFloat(i.quantity);
    }, 0) ?? 0;
  // Preview only — mirrors Order._describe_item()'s exclusive-tax formula
  // (line_total * rate / 100, quantized to cents; inclusive classes and
  // items with no tax class contribute 0). The authoritative number is
  // still computed server-side at bill() time; this just avoids the old
  // "no tax shown until checkout" gap on the cart screen.
  const taxTotal =
    order?.items.reduce((sum, i) => {
      const menuItem = menuItems?.find((m) => m.id === i.menu_item);
      const taxClass = menuItem?.tax_class ? taxClassById.get(menuItem.tax_class) : undefined;
      if (!taxClass || taxClass.is_inclusive) return sum;
      const modTotal = i.modifiers.reduce((m, mm) => m + parseFloat(mm.price_delta), 0);
      const lineTotal = (parseFloat(i.unit_price) + modTotal) * parseFloat(i.quantity);
      return sum + Math.round(lineTotal * parseFloat(taxClass.rate_percent)) / 100;
    }, 0) ?? 0;
  const grandTotal = subtotal + taxTotal;

  const quickPay = useMutation({
    mutationFn: async () => {
      const { data: invoice } = await api.post<InvoiceT>(`/orders/${orderId}/bill/`, {});
      try {
        await api.post(`/invoices/${invoice.id}/payments/`, {
          method: paymentMethod,
          amount: invoice.grand_total,
        });
        await api.post(`/invoices/${invoice.id}/finalize/`);
      } catch (err) {
        // The invoice already exists at this point — send the cashier to
        // checkout to finish payment there rather than stranding them on
        // a cart screen for an order that's already been billed.
        router.push(`/pos/checkout/${orderId}`);
        throw err;
      }
      return invoice;
    },
    onSuccess: (invoice) => router.push(`/pos/checkout/${invoice.order}`),
    onError: (err) => {
      const data = (err as { response?: { data?: unknown } })?.response?.data;
      window.alert(
        typeof data === "object" && data
          ? JSON.stringify(data)
          : "Could not complete quick checkout — check the order in Checkout."
      );
    },
  });

  const chargeToRoomMutation = useMutation({
    mutationFn: async () =>
      api.post(`/orders/${orderId}/charge-to-room/`, { guest_stay_id: chargeToRoom!.guestStayId }),
    onSuccess: () => chargeToRoom!.onCharged(),
    onError: (err: unknown) => {
      const data = (err as { response?: { data?: unknown } })?.response?.data;
      const message = Array.isArray(data) ? data[0] : undefined;
      window.alert(message ?? "Could not charge this order to the room.");
    },
  });

  if (isLoading || !order) {
    return <p className="text-sm text-neutral-500">Loading order…</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
      {/* Menu */}
      <div className="space-y-4">
        <IconInput
          icon={<SearchIcon />}
          placeholder="Search menu items…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveCategory("ALL")}
            className={cn(
              "rounded-full px-4 py-1.5 text-xs font-medium transition-colors",
              activeCategory === "ALL"
                ? "bg-[#E5484D] text-white"
                : "bg-white text-neutral-600 ring-1 ring-neutral-200 hover:bg-neutral-50"
            )}
          >
            All {menuItems?.length ?? 0}
          </button>
          {categories?.map((cat) => {
            const count = (menuItems ?? []).filter((m) => m.category === cat.id).length;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={cn(
                  "rounded-full px-4 py-1.5 text-xs font-medium transition-colors",
                  activeCategory === cat.id
                    ? "bg-[#E5484D] text-white"
                    : "bg-white text-neutral-600 ring-1 ring-neutral-200 hover:bg-neutral-50"
                )}
              >
                {cat.name} {count}
              </button>
            );
          })}
        </div>

        {pickerItem && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setPickerItem(null)}
          >
            <div
              className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative">
                <div
                  className="flex h-32 items-center justify-center overflow-hidden rounded-t-2xl text-3xl font-semibold text-white/90 sm:h-40"
                  style={pickerItem.image ? undefined : { background: nameToGradient(pickerItem.name) }}
                >
                  {pickerItem.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={pickerItem.image}
                      alt={pickerItem.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    pickerItem.name.charAt(0).toUpperCase()
                  )}
                </div>
                <button
                  onClick={() => setPickerItem(null)}
                  className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-neutral-500 shadow hover:bg-white hover:text-neutral-700"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              <div className="border-b border-neutral-100 p-4">
                <p className="font-semibold text-neutral-900">{pickerItem.name}</p>
                <p className="text-xs text-neutral-400">Base price {formatCurrency(pickerItem.price)}</p>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto p-4">
                {pickerItem.modifier_groups.map((group) => (
                  <div key={group.id}>
                    <div className="mb-2 flex items-center gap-1.5">
                      <p className="text-sm font-medium text-neutral-900">{group.name}</p>
                      {group.is_required && (
                        <span className="text-xs font-medium text-[#E5484D]">(Required)</span>
                      )}
                      {group.selection_type === "MULTIPLE" && (
                        <span className="text-xs text-neutral-400">— choose any</span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {group.modifiers.map((mod) => {
                        const checked = selectedModifiers.includes(mod.id);
                        return (
                          <button
                            key={mod.id}
                            type="button"
                            onClick={() => toggleModifier(group, mod.id)}
                            className={cn(
                              "rounded-xl border px-3 py-2 text-left text-xs font-medium transition-colors",
                              checked
                                ? "border-[#E5484D] bg-[#FDECEC] text-[#E5484D]"
                                : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                            )}
                          >
                            <p>{mod.name}</p>
                            {parseFloat(mod.price_delta) > 0 && (
                              <p className="mt-0.5 text-neutral-400">+{formatCurrency(mod.price_delta)}</p>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-3 border-t border-neutral-100 p-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-400">
                    Special request (optional)
                  </label>
                  <input
                    placeholder="e.g. no onions, extra spicy"
                    value={pickerNotes}
                    onChange={(e) => setPickerNotes(e.target.value)}
                    className="h-9 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 text-sm outline-none focus:border-[#E5484D]"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-neutral-500">Quantity</span>
                  <div className="flex items-center gap-3 rounded-full border border-neutral-200 px-2 py-1">
                    <button
                      onClick={() => setPickerQuantity((q) => Math.max(1, q - 1))}
                      className="flex h-6 w-6 items-center justify-center text-neutral-500"
                    >
                      <MinusIcon className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-4 text-center text-sm font-medium">{pickerQuantity}</span>
                    <button
                      onClick={() => setPickerQuantity((q) => q + 1)}
                      className="flex h-6 w-6 items-center justify-center text-neutral-500"
                    >
                      <PlusIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPickerItem(null)}
                    className="rounded-xl px-4 py-2.5 text-sm font-medium text-neutral-500 hover:bg-neutral-100"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() =>
                      addItem.mutate({
                        item: pickerItem,
                        modifiers: selectedModifiers,
                        quantity: pickerQuantity,
                        notes: pickerNotes,
                      })
                    }
                    disabled={addItem.isPending}
                    className="flex-1 rounded-xl bg-[#E5484D] py-2.5 text-sm font-medium text-white hover:bg-[#D6393E] disabled:opacity-60"
                  >
                    Add to order — {formatCurrency(pickerLineTotal)}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {filteredItems.map((item) => {
            const qty = cartQuantityFor(item.id);
            return (
              <div
                key={item.id}
                className="overflow-hidden rounded-2xl border border-neutral-200 bg-white transition-shadow hover:shadow-md"
              >
                <div
                  className="relative flex h-36 items-center justify-center overflow-hidden text-2xl font-semibold text-white/90"
                  style={item.image ? undefined : { background: nameToGradient(item.name) }}
                >
                  {item.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.image} alt={item.name} className="h-full w-full object-cover" />
                  ) : (
                    item.name.charAt(0).toUpperCase()
                  )}
                  {qty > 0 && (
                    <span className="absolute right-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[11px] font-semibold text-[#E5484D] shadow">
                      {qty}
                    </span>
                  )}
                </div>
                <div className="space-y-2 p-3">
                  <p className="truncate text-sm font-medium text-neutral-900">{item.name}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-[#E5484D]">
                      {formatCurrency(item.price)}
                    </span>
                    <button
                      onClick={() => handleItemClick(item)}
                      disabled={orderSettled || addItem.isPending}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                        qty > 0
                          ? "bg-[#FDECEC] text-[#E5484D]"
                          : "bg-[#E5484D] text-white hover:bg-[#D6393E]",
                        "disabled:opacity-50"
                      )}
                    >
                      + Add
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {filteredItems.length === 0 && (
            <p className="col-span-full text-sm text-neutral-500">No menu items match.</p>
          )}
        </div>

        {heldOrders && heldOrders.length > 0 && (
          <div className="space-y-2 border-t border-neutral-200 pt-4">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#E5484D]" />
              <p className="text-sm font-semibold text-neutral-900">Saved Orders</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {heldOrders
                .filter((o) => o.id !== order.id)
                .map((o) => (
                  <button
                    key={o.id}
                    onClick={() => resumeHeldOrder.mutate(o.id)}
                    disabled={resumeHeldOrder.isPending}
                    className="rounded-xl border border-neutral-200 bg-white p-3 text-left text-xs transition-colors hover:border-[#E5484D] disabled:opacity-50"
                  >
                    <p className="font-medium text-neutral-900">Order #{o.id.slice(0, 8)}</p>
                    <p className={cn("mt-0.5 font-medium", ORDER_TYPE_TONE[o.order_type])}>
                      {o.order_type.replace(/_/g, " ")}
                    </p>
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Order list / cart */}
      <Card className="h-fit lg:sticky lg:top-6">
        <CardContent className="space-y-4 p-4">
          <p className="font-semibold text-neutral-900">Order List</p>

          {!chargeToRoom && (
            <div className="flex rounded-lg bg-neutral-100 p-1 text-xs font-medium">
              {ORDER_TYPE_TABS.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => changeOrderType.mutate(tab.value)}
                  disabled={cartLocked || changeOrderType.isPending || order.order_type === tab.value}
                  className={cn(
                    "flex-1 rounded-md py-1.5 transition-colors disabled:cursor-default",
                    order.order_type === tab.value
                      ? "bg-white text-[#E5484D] shadow-sm"
                      : "text-neutral-500 hover:text-neutral-700 disabled:hover:text-neutral-500"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          {order.order_type === "DINE_IN" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-400">Choose Table</label>
              <select
                value={order.table ?? ""}
                disabled={orderSettled || changeTable.isPending}
                onChange={(e) => e.target.value && changeTable.mutate(e.target.value)}
                className="h-9 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-2 text-sm disabled:opacity-60"
              >
                <option value="" disabled>
                  Select table…
                </option>
                {assignableTables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="max-h-[300px] space-y-3 overflow-y-auto pr-1">
            {order.items.map((item) => {
              const modTotal = item.modifiers.reduce((m, mm) => m + parseFloat(mm.price_delta), 0);
              const lineTotal = (parseFloat(item.unit_price) + modTotal) * parseFloat(item.quantity);
              const name = menuItemName(item.menu_item);
              const image = menuItemImage(item.menu_item);
              const locked = orderSettled || item.sent_to_kitchen;
              return (
                <div key={item.id} className="flex gap-3">
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={image} alt={name} className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <div
                      className="h-12 w-12 shrink-0 rounded-xl"
                      style={{ background: nameToGradient(name) }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-medium text-neutral-900">{name}</p>
                      <span className="shrink-0 text-sm font-medium">{formatCurrency(lineTotal)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {item.modifiers.length > 0 && (
                        <p className="truncate text-xs text-neutral-400">
                          +{item.modifiers.length} modifier{item.modifiers.length > 1 ? "s" : ""}
                        </p>
                      )}
                      {item.sent_to_kitchen && (
                        <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500">
                          Sent to kitchen
                        </span>
                      )}
                    </div>
                    {item.notes && (
                      <p className="truncate text-xs italic text-neutral-400">— {item.notes}</p>
                    )}
                    <div className="mt-1 flex items-center justify-between">
                      <div className="flex items-center gap-1.5 rounded-full border border-neutral-200 px-1.5 py-0.5">
                        <button
                          disabled={locked || setItemQuantity.isPending}
                          onClick={() =>
                            setItemQuantity.mutate({
                              itemId: item.id,
                              quantity: Math.max(1, parseFloat(item.quantity) - 1),
                            })
                          }
                          className="flex h-5 w-5 items-center justify-center text-neutral-500 disabled:opacity-40"
                        >
                          <MinusIcon className="h-3 w-3" />
                        </button>
                        <span className="w-4 text-center text-xs font-medium">{item.quantity}</span>
                        <button
                          disabled={locked || setItemQuantity.isPending}
                          onClick={() =>
                            setItemQuantity.mutate({
                              itemId: item.id,
                              quantity: parseFloat(item.quantity) + 1,
                            })
                          }
                          className="flex h-5 w-5 items-center justify-center text-neutral-500 disabled:opacity-40"
                        >
                          <PlusIcon className="h-3 w-3" />
                        </button>
                      </div>
                      {!locked && (
                        <button
                          onClick={() => removeItem.mutate(item.id)}
                          disabled={removeItem.isPending}
                          className="flex h-6 w-6 items-center justify-center rounded-full border border-neutral-200 text-neutral-400 hover:border-red-300 hover:text-red-500"
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {order.items.length === 0 && (
              <p className="py-6 text-center text-sm text-neutral-400">Cart is empty — tap a dish to add it.</p>
            )}
          </div>

          {!chargeToRoom && (
            <div className="space-y-1 border-t border-neutral-100 pt-3">
              {attachedCustomer ? (
                <p className="text-sm">
                  Customer: <span className="font-medium">{attachedCustomer.name || attachedCustomer.phone}</span>
                </p>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-neutral-400">Attach customer (optional)</p>
                  <div className="flex gap-1.5">
                    <input
                      placeholder="Phone"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      className="h-8 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-2 text-xs outline-none focus:border-[#E5484D]"
                    />
                    <input
                      placeholder="Name"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="h-8 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-2 text-xs outline-none focus:border-[#E5484D]"
                    />
                  </div>
                  <button
                    disabled={!customerPhone || attachCustomer.isPending}
                    onClick={() => attachCustomer.mutate()}
                    className="w-full rounded-lg bg-neutral-100 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-200 disabled:opacity-50"
                  >
                    Attach
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1 border-t border-neutral-100 pt-3 text-sm">
            <div className="flex justify-between text-neutral-500">
              <span>Sub Total</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            {taxTotal > 0 && (
              <div className="flex justify-between text-neutral-500">
                <span>Tax</span>
                <span>{formatCurrency(taxTotal)}</span>
              </div>
            )}
            <div className="flex justify-between pt-1 text-base font-semibold text-neutral-900">
              <span>Total Amount</span>
              <span>{formatCurrency(grandTotal)}</span>
            </div>
          </div>

          {!chargeToRoom && !cartLocked && order.items.length > 0 && (
            <div className="space-y-1.5 border-t border-neutral-100 pt-3">
              <p className="text-xs font-medium text-neutral-400">Pay with (optional — quick checkout)</p>
              <div className="flex gap-1.5">
                {PAYMENT_CHIPS.map((chip) => (
                  <button
                    key={chip.value}
                    type="button"
                    onClick={() =>
                      setPaymentMethod((prev) => (prev === chip.value ? null : chip.value))
                    }
                    className={cn(
                      "flex-1 rounded-lg border py-1.5 text-xs font-medium transition-colors",
                      paymentMethod === chip.value
                        ? "border-[#E5484D] bg-[#FDECEC] text-[#E5484D]"
                        : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                    )}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2 pt-1">
            <button
              onClick={() => sendToKitchen.mutate()}
              disabled={!hasUnsentItems || sendToKitchen.isPending || orderSettled}
              className="w-full rounded-xl bg-neutral-900 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {cartLocked ? "Send new items to kitchen" : "Send to kitchen"}
            </button>
            {chargeToRoom ? (
              <button
                onClick={() => chargeToRoomMutation.mutate()}
                disabled={order.items.length === 0 || chargeToRoomMutation.isPending}
                className="w-full rounded-xl bg-[#E5484D] py-2.5 text-sm font-medium text-white hover:bg-[#D6393E] disabled:opacity-50"
              >
                {chargeToRoomMutation.isPending ? "Charging…" : "Charge to room"}
              </button>
            ) : (
              <>
                <button
                  onClick={() =>
                    paymentMethod ? quickPay.mutate() : router.push(`/pos/checkout/${order.id}`)
                  }
                  disabled={order.items.length === 0 || quickPay.isPending}
                  className="w-full rounded-xl bg-[#E5484D] py-2.5 text-sm font-medium text-white hover:bg-[#D6393E] disabled:opacity-50"
                >
                  {quickPay.isPending ? "Billing…" : "Generate Bill"}
                </button>
                <button
                  onClick={() => hold.mutate()}
                  className="w-full rounded-xl py-2 text-sm text-neutral-500 hover:bg-neutral-50"
                >
                  Save Order
                </button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
