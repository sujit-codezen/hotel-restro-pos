"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { api } from "@/lib/api";
import { Paginated } from "@/lib/hooks";
import { InvoiceT } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

const PAYMENT_METHODS = ["CASH", "CARD", "ESEWA", "KHALTI", "QR", "BANK_TRANSFER"];

type DiscountOption = { id: string; name: string; type: "PERCENT" | "FIXED"; value: string };

export function InvoiceCard({
  invoice,
  onChanged,
  onFinalized,
}: {
  invoice: InvoiceT;
  onChanged: () => void;
  onFinalized?: () => void;
}) {
  const [showPayForm, setShowPayForm] = useState(false);
  const [method, setMethod] = useState("CASH");
  const [amount, setAmount] = useState("");
  const [tendered, setTendered] = useState("");
  const [refundingPaymentId, setRefundingPaymentId] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [selectedDiscountId, setSelectedDiscountId] = useState("");

  // Nothing paid yet (balance_due back at grand_total) is the same window
  // Invoice.apply_discount()/void() enforce server-side — a discount can't
  // be changed once money's changed hands.
  const nothingPaidYet = invoice.balance_due >= parseFloat(invoice.grand_total);

  const { data: discounts } = useQuery<DiscountOption[]>({
    queryKey: ["discounts"],
    queryFn: async () => (await api.get<Paginated<DiscountOption>>("/discounts/")).data.results,
    enabled: nothingPaidYet && invoice.status !== "VOID",
  });

  const applyDiscount = useMutation({
    mutationFn: async () =>
      api.post(`/invoices/${invoice.id}/discount/`, { discount_id: selectedDiscountId }),
    onSuccess: () => {
      setSelectedDiscountId("");
      onChanged();
    },
  });

  const removeDiscount = useMutation({
    mutationFn: async () => api.delete(`/invoices/${invoice.id}/discount/`),
    onSuccess: () => onChanged(),
  });

  const addPayment = useMutation({
    mutationFn: async () => {
      const payload: Record<string, string> = { method, amount };
      if (method === "CASH" && tendered) payload.tendered_amount = tendered;
      return api.post(`/invoices/${invoice.id}/payments/`, payload);
    },
    onSuccess: () => {
      setAmount("");
      setTendered("");
      setShowPayForm(false);
      onChanged();
    },
  });

  const finalize = useMutation({
    mutationFn: async () => api.post(`/invoices/${invoice.id}/finalize/`),
    onSuccess: () => {
      onChanged();
      onFinalized?.();
    },
  });

  const refund = useMutation({
    mutationFn: async (paymentId: string) =>
      api.post(`/invoices/${invoice.id}/refund/`, {
        payment_id: paymentId,
        amount: refundAmount,
        reason: refundReason,
      }),
    onSuccess: () => {
      setRefundingPaymentId(null);
      setRefundAmount("");
      setRefundReason("");
      onChanged();
    },
  });

  const voidInvoice = useMutation({
    mutationFn: async () => api.post(`/invoices/${invoice.id}/void/`),
    onSuccess: () => onChanged(),
  });

  // balance_due = grand_total - net_paid (see billing.serializers), so
  // balance_due reaching grand_total again means net_paid <= 0 — mirrors
  // the same condition Invoice.void() enforces server-side.
  const canVoid = invoice.status !== "VOID" && invoice.balance_due >= parseFloat(invoice.grand_total);

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <p className="font-medium">Invoice {invoice.display_number ?? "(draft)"}</p>
          <Badge
            tone={
              invoice.status === "PAID"
                ? "green"
                : invoice.status === "VOID"
                  ? "neutral"
                  : "yellow"
            }
          >
            {invoice.status.replace(/_/g, " ")}
          </Badge>
        </div>

        <div className="space-y-1 text-sm">
          {invoice.lines.map((line) => (
            <div key={line.id} className="flex justify-between">
              <span>
                {line.description} × {line.quantity}
              </span>
              <span>{formatCurrency(parseFloat(line.unit_price) * parseFloat(line.quantity))}</span>
            </div>
          ))}
        </div>

        <div className="space-y-1 border-t border-neutral-200 pt-2 text-sm">
          <div className="flex justify-between text-neutral-600">
            <span>Subtotal</span>
            <span>{formatCurrency(invoice.subtotal)}</span>
          </div>
          {parseFloat(invoice.discount_total) > 0 && (
            <div className="flex justify-between text-[#E5484D]">
              <span>Discount{invoice.discount_name ? ` (${invoice.discount_name})` : ""}</span>
              <span>-{formatCurrency(invoice.discount_total)}</span>
            </div>
          )}
          {parseFloat(invoice.tax_total) > 0 && (
            <div className="flex justify-between">
              <span>Tax</span>
              <span>{formatCurrency(invoice.tax_total)}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold">
            <span>Total</span>
            <span>{formatCurrency(invoice.grand_total)}</span>
          </div>
          <div className="flex justify-between text-neutral-600">
            <span>Balance due</span>
            <span>{formatCurrency(invoice.balance_due)}</span>
          </div>
        </div>

        {nothingPaidYet && invoice.status !== "VOID" && (
          <div className="border-t border-neutral-200 pt-3">
            {invoice.discount ? (
              <div className="flex items-center justify-between text-sm">
                <span>
                  Discount applied: <span className="font-medium">{invoice.discount_name}</span>
                </span>
                <button
                  onClick={() => removeDiscount.mutate()}
                  disabled={removeDiscount.isPending}
                  className="text-xs text-neutral-400 hover:text-red-500 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            ) : (
              discounts &&
              discounts.length > 0 && (
                <div className="flex gap-2">
                  <Select
                    value={selectedDiscountId}
                    onChange={(e) => setSelectedDiscountId(e.target.value)}
                    className="text-sm"
                  >
                    <option value="">Apply a discount…</option>
                    {discounts.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.type === "PERCENT" ? `${d.value}%` : `Rs. ${d.value}`})
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!selectedDiscountId || applyDiscount.isPending}
                    onClick={() => applyDiscount.mutate()}
                  >
                    Apply
                  </Button>
                </div>
              )
            )}
          </div>
        )}

        {invoice.payments.length > 0 && (
          <div className="space-y-2 border-t border-neutral-200 pt-2 text-sm">
            <p className="text-xs font-medium text-neutral-500">Payments</p>
            {invoice.payments.map((p) => (
              <div key={p.id} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span>{p.method}</span>
                  <span className="flex items-center gap-2">
                    {formatCurrency(p.amount)}
                    {p.refundable_amount > 0 && invoice.status !== "VOID" && (
                      <button
                        type="button"
                        className="text-xs text-neutral-500 underline"
                        onClick={() =>
                          setRefundingPaymentId(refundingPaymentId === p.id ? null : p.id)
                        }
                      >
                        Refund
                      </button>
                    )}
                  </span>
                </div>
                {p.refunds.map((r) => (
                  <div key={r.id} className="flex justify-between pl-3 text-xs text-red-600">
                    <span>Refunded{r.reason ? ` — ${r.reason}` : ""}</span>
                    <span>-{formatCurrency(r.amount)}</span>
                  </div>
                ))}
                {refundingPaymentId === p.id && (
                  <div className="space-y-2 rounded-md border border-neutral-200 p-2">
                    <Input
                      placeholder={`Amount (up to ${formatCurrency(p.refundable_amount)})`}
                      value={refundAmount}
                      onChange={(e) => setRefundAmount(e.target.value)}
                    />
                    <Input
                      placeholder="Reason (optional)"
                      value={refundReason}
                      onChange={(e) => setRefundReason(e.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="danger"
                      className="w-full"
                      disabled={!refundAmount || refund.isPending}
                      onClick={() => refund.mutate(p.id)}
                    >
                      Confirm refund
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {invoice.balance_due > 0 && invoice.status !== "VOID" && (
          <div className="space-y-2 border-t border-neutral-200 pt-4">
            {!showPayForm ? (
              <Button size="sm" variant="secondary" className="w-full" onClick={() => setShowPayForm(true)}>
                Add payment
              </Button>
            ) : (
              <>
                <Label>Add payment</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </Select>
                  <Input placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                {method === "CASH" && (
                  <Input
                    placeholder="Tendered amount (for change)"
                    value={tendered}
                    onChange={(e) => setTendered(e.target.value)}
                  />
                )}
                <Button
                  className="w-full"
                  onClick={() => addPayment.mutate()}
                  disabled={!amount || addPayment.isPending}
                >
                  Record payment
                </Button>
              </>
            )}
          </div>
        )}

        {invoice.status !== "VOID" && (
          <Button
            className="w-full"
            variant="secondary"
            onClick={() => finalize.mutate()}
            disabled={finalize.isPending || !!invoice.display_number}
          >
            {invoice.display_number ? "Finalized" : "Finalize & print receipt"}
          </Button>
        )}

        {canVoid && (
          <Button
            className="w-full"
            variant="danger"
            onClick={() => voidInvoice.mutate()}
            disabled={voidInvoice.isPending}
          >
            Void invoice
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
