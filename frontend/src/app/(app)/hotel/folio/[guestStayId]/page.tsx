"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { InvoiceCard } from "@/components/invoice-card";
import { PosOrderScreen } from "@/components/pos-order-screen";
import {
  BedIcon,
  DoorIcon,
  PlusIcon,
  ReceiptIcon,
  UsersIcon,
  UtensilsIcon,
  XIcon,
} from "@/components/ui/icons";
import { api } from "@/lib/api";
import { Paginated, useStores } from "@/lib/hooks";
import { Folio, GuestStay, InvoiceT, OrderT } from "@/lib/types";
import { cn, findRestaurantStoreFor, formatCurrency } from "@/lib/utils";

const LINE_TYPES = ["SERVICE", "LAUNDRY", "MISC"];
const PAYMENT_METHODS = ["CASH", "CARD", "ESEWA", "KHALTI", "QR", "BANK_TRANSFER"];
const IN_PROGRESS_STATUSES = new Set(["OPEN", "HELD"]);

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

/** Popup for taking an advance/deposit payment mid-stay — before there's
 * an invoice to record a real Payment against, so this is a FolioDeposit
 * instead; Folio.close() carries it over as a real Payment at checkout so
 * the guest isn't charged for it twice. */
function DepositModal({
  onClose,
  onSubmit,
  submitting,
  error,
}: {
  onClose: () => void;
  onSubmit: (values: { method: string; amount: string; reference: string }) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [method, setMethod] = useState("CASH");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const valid = amount.trim() && parseFloat(amount) > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm animate-[fadeIn_0.15s_ease-out] rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-neutral-100 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FDECEC] text-[#E5484D]">
            <ReceiptIcon className="h-5 w-5" />
          </span>
          <p className="flex-1 font-semibold text-neutral-900">Take advance payment</p>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
            aria-label="Close"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">Method</label>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={cn(
                    "rounded-xl border py-2 text-xs font-medium transition-colors",
                    method === m
                      ? "border-[#E5484D] bg-[#FDECEC] text-[#E5484D]"
                      : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                  )}
                >
                  {m.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">Amount</label>
            <input
              autoFocus
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">
              Reference <span className="text-neutral-300">(optional)</span>
            </label>
            <input
              placeholder="Transaction / receipt ID"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
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
            onClick={() => valid && onSubmit({ method, amount, reference })}
            disabled={!valid || submitting}
            className="flex-1 rounded-xl bg-[#E5484D] py-2.5 text-sm font-medium text-white hover:bg-[#D6393E] disabled:opacity-60"
          >
            {submitting ? "Recording…" : "Record payment"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FolioPage() {
  const { guestStayId } = useParams<{ guestStayId: string }>();
  const queryClient = useQueryClient();
  const { data: stores } = useStores();

  const [lineType, setLineType] = useState("MISC");
  const [description, setDescription] = useState("");
  const [chargeAmount, setChargeAmount] = useState("");
  const [showAddCharge, setShowAddCharge] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [confirmingCheckout, setConfirmingCheckout] = useState(false);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  // The room-service order being built for this stay, kept on the page
  // instead of navigating to /pos/order/[id] — "no redirect, right side
  // is the POS for this room" was the explicit ask. `dismissed` stops the
  // resume-on-load effect below from instantly reopening a panel the
  // cashier just closed (the order itself stays OPEN/HELD either way;
  // dismissing only hides the panel, it doesn't cancel anything).
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const { data: stay } = useQuery<GuestStay>({
    queryKey: ["guest-stay", guestStayId],
    queryFn: async () => (await api.get(`/guest-stays/${guestStayId}/`)).data,
  });

  const { data: folio, refetch } = useQuery<Folio | null>({
    queryKey: ["folio", guestStayId],
    queryFn: async () => {
      const { data } = await api.get<Paginated<Folio>>("/folios/", {
        params: { guest_stay: guestStayId },
      });
      return data.results[0] ?? null;
    },
  });

  const { data: invoice } = useQuery<InvoiceT>({
    queryKey: ["folio-invoice", invoiceId],
    queryFn: async () => (await api.get<InvoiceT>(`/invoices/${invoiceId}/`)).data,
    enabled: !!invoiceId,
  });

  const restaurantStore = findRestaurantStoreFor(stores, stay?.store);

  // So refreshing the page (or coming back later) doesn't lose an
  // in-progress room-service order that was never charged/cancelled yet.
  const { data: roomServiceOrders } = useQuery<OrderT[]>({
    queryKey: ["room-service-orders", guestStayId],
    queryFn: async () =>
      (
        await api.get<Paginated<OrderT>>("/orders/", {
          params: { guest_stay: guestStayId, order_type: "ROOM_SERVICE" },
        })
      ).data.results,
    enabled: !!guestStayId,
  });

  useEffect(() => {
    if (activeOrderId || dismissed) return;
    const inProgress = roomServiceOrders?.find((o) => IN_PROGRESS_STATUSES.has(o.status));
    if (inProgress) setActiveOrderId(inProgress.id);
  }, [roomServiceOrders, activeOrderId, dismissed]);

  const addLine = useMutation({
    mutationFn: async () =>
      api.post(`/folios/${folio!.id}/lines/`, {
        line_type: lineType,
        description,
        quantity: 1,
        unit_price: chargeAmount,
      }),
    onSuccess: () => {
      setDescription("");
      setChargeAmount("");
      setShowAddCharge(false);
      refetch();
    },
  });

  const addDeposit = useMutation({
    mutationFn: async (values: { method: string; amount: string; reference: string }) =>
      api.post(`/folios/${folio!.id}/deposits/`, {
        method: values.method,
        amount: values.amount,
        reference_number: values.reference,
      }),
    onSuccess: () => {
      setShowDeposit(false);
      setDepositError(null);
      refetch();
    },
    onError: (err: unknown) => setDepositError(errorMessage(err, "Could not record that payment.")),
  });

  const orderFood = useMutation({
    mutationFn: async () =>
      (
        await api.post<OrderT>("/orders/", {
          store: restaurantStore!.id,
          order_type: "ROOM_SERVICE",
          guest_stay: guestStayId,
        })
      ).data,
    onSuccess: (order) => {
      setDismissed(false);
      setActiveOrderId(order.id);
    },
  });

  const checkOut = useMutation({
    mutationFn: async () =>
      (await api.post<InvoiceT>(`/guest-stays/${guestStayId}/check-out/`)).data,
    onSuccess: (data) => setInvoiceId(data.id),
  });

  function handleCharged() {
    setActiveOrderId(null);
    setDismissed(false);
    refetch();
    queryClient.invalidateQueries({ queryKey: ["room-service-orders", guestStayId] });
  }

  if (!stay || !folio) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-32 animate-pulse rounded-lg bg-neutral-100" />
        <div className="h-40 animate-pulse rounded-2xl bg-neutral-100" />
      </div>
    );
  }

  const displayName = stay.guest_name || stay.guest_phone;
  const inHouse = stay.status === "IN_HOUSE" && folio.status === "OPEN" && !invoiceId;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Folio</h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-neutral-500">
            <span className="flex items-center gap-1">
              <UsersIcon className="h-4 w-4 text-neutral-300" /> {displayName}
            </span>
            <span className="flex items-center gap-1">
              <DoorIcon className="h-4 w-4 text-neutral-300" /> Room {stay.room_number}
            </span>
          </div>
        </div>
        <span
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
            stay.status === "IN_HOUSE" ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-600"
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", stay.status === "IN_HOUSE" ? "bg-emerald-500" : "bg-neutral-400")} />
          {stay.status === "IN_HOUSE" ? "In house" : "Checked out"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_1fr]">
        {/* Left: the bill */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <p className="mb-3 text-sm font-medium text-neutral-500">Charges</p>
            <div className="space-y-2 text-sm">
              {folio.lines.map((line) => (
                <div key={line.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-neutral-700">
                    {line.description}{" "}
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">
                      {line.line_type.replace("_", " ").toLowerCase()}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium text-neutral-900">{formatCurrency(line.amount)}</span>
                </div>
              ))}
              {folio.lines.length === 0 && <p className="text-sm text-neutral-400">No charges yet.</p>}
            </div>

            <div className="mt-4 space-y-1 border-t border-neutral-100 pt-3 text-sm">
              <div className="flex justify-between text-neutral-500">
                <span>Total charges</span>
                <span>{formatCurrency(folio.total)}</span>
              </div>
              {folio.total_deposits > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <span>Advance paid</span>
                  <span>-{formatCurrency(folio.total_deposits)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-semibold text-neutral-900">
                <span>Balance due</span>
                <span>{formatCurrency(folio.balance_due)}</span>
              </div>
            </div>
          </div>

          {folio.deposits.length > 0 && (
            <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
              <p className="mb-3 text-sm font-medium text-neutral-500">Advance payments</p>
              <div className="space-y-2 text-sm">
                {folio.deposits.map((d) => (
                  <div key={d.id} className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-neutral-700">
                      {d.method.replace("_", " ")}
                      {d.reference_number && (
                        <span className="text-xs text-neutral-400">#{d.reference_number}</span>
                      )}
                    </span>
                    <span className="font-medium text-emerald-600">{formatCurrency(d.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {inHouse && (
            <>
              <button
                onClick={() => {
                  setDepositError(null);
                  setShowDeposit(true);
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-neutral-200 bg-white py-2.5 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50"
              >
                <ReceiptIcon className="h-4 w-4" /> Take advance payment
              </button>

              <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                {!showAddCharge ? (
                  <button
                    onClick={() => setShowAddCharge(true)}
                    className="flex w-full items-center justify-center gap-1.5 text-sm font-medium text-neutral-600 hover:text-neutral-900"
                  >
                    <PlusIcon className="h-4 w-4" /> Add manual charge
                  </button>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-neutral-700">Add manual charge</p>
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={lineType}
                        onChange={(e) => setLineType(e.target.value)}
                        className="h-10 rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
                      >
                        {LINE_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <input
                        placeholder="Amount"
                        value={chargeAmount}
                        onChange={(e) => setChargeAmount(e.target.value)}
                        className="h-10 rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
                      />
                    </div>
                    <input
                      placeholder="Description (e.g. Laundry service)"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowAddCharge(false)}
                        className="rounded-xl px-4 py-2 text-sm font-medium text-neutral-500 hover:bg-neutral-100"
                      >
                        Cancel
                      </button>
                      <button
                        disabled={!description || !chargeAmount || addLine.isPending}
                        onClick={() => addLine.mutate()}
                        className="flex-1 rounded-xl bg-neutral-900 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
                      >
                        {addLine.isPending ? "Adding…" : "Add charge"}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {!confirmingCheckout ? (
                <button
                  onClick={() => setConfirmingCheckout(true)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#E5484D] py-2.5 text-sm font-medium text-white shadow-sm shadow-[#E5484D]/20 hover:bg-[#D6393E]"
                >
                  <BedIcon className="h-4 w-4" /> Check out &amp; settle folio
                </button>
              ) : (
                <div className="space-y-2 rounded-xl bg-red-50 p-3">
                  <p className="text-sm text-red-700">
                    Settle this folio and check the guest out? This finalizes all charges into one invoice.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmingCheckout(false)}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-white"
                    >
                      Not yet
                    </button>
                    <button
                      onClick={() => checkOut.mutate()}
                      disabled={checkOut.isPending}
                      className="flex-1 rounded-lg bg-red-600 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
                    >
                      {checkOut.isPending ? "Checking out…" : "Yes, check out & settle"}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {invoice && (
            <InvoiceCard
              invoice={invoice}
              onChanged={() => {
                queryClient.invalidateQueries({ queryKey: ["folio-invoice", invoiceId] });
                queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
              }}
            />
          )}
        </div>

        {/* Right: the room-service POS for this stay — built and settled
           right here, never a separate page, per the explicit "no redirect"
           request. */}
        {inHouse && (
          <div className="min-w-0">
            {activeOrderId ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 shadow-sm">
                  <span className="flex items-center gap-2 text-sm font-medium text-neutral-700">
                    <UtensilsIcon className="h-4 w-4 text-[#E5484D]" /> Room service order for Room{" "}
                    {stay.room_number}
                  </span>
                  <button
                    onClick={() => {
                      setActiveOrderId(null);
                      setDismissed(true);
                    }}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
                  >
                    <XIcon className="h-3.5 w-3.5" /> Close
                  </button>
                </div>
                <PosOrderScreen
                  orderId={activeOrderId}
                  onSwitchOrder={setActiveOrderId}
                  onDone={() => setActiveOrderId(null)}
                  chargeToRoom={{ guestStayId, onCharged: handleCharged }}
                />
              </div>
            ) : restaurantStore ? (
              <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/50 py-14 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-neutral-300 shadow-sm">
                  <UtensilsIcon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-medium text-neutral-700">No order in progress</p>
                  <p className="mt-0.5 text-xs text-neutral-400">Start one to add food straight to this room.</p>
                </div>
                <button
                  onClick={() => orderFood.mutate()}
                  disabled={orderFood.isPending}
                  className="mt-1 flex items-center gap-1.5 rounded-xl bg-[#E5484D] px-4 py-2 text-sm font-medium text-white hover:bg-[#D6393E] disabled:opacity-60"
                >
                  <PlusIcon className="h-4 w-4" /> {orderFood.isPending ? "Starting…" : "Order food"}
                </button>
              </div>
            ) : (
              <div className="flex h-full min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/50 py-14 text-center text-sm text-neutral-400">
                No linked restaurant to order from.
              </div>
            )}
          </div>
        )}
      </div>

      {showDeposit && (
        <DepositModal
          onClose={() => setShowDeposit(false)}
          onSubmit={(values) => addDeposit.mutate(values)}
          submitting={addDeposit.isPending}
          error={depositError}
        />
      )}
    </div>
  );
}
