"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { Paginated } from "@/lib/hooks";
import { Customer, InvoiceT, Reservation } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

export default function CustomerDetailPage() {
  const { customerId } = useParams<{ customerId: string }>();

  const { data: customer } = useQuery<Customer>({
    queryKey: ["customer", customerId],
    queryFn: async () => (await api.get<Customer>(`/customers/${customerId}/`)).data,
  });

  const { data: invoices } = useQuery<InvoiceT[]>({
    queryKey: ["customer-invoices", customerId],
    queryFn: async () =>
      (await api.get<Paginated<InvoiceT>>("/invoices/", { params: { customer: customerId } }))
        .data.results,
  });

  const { data: reservations } = useQuery<Reservation[]>({
    queryKey: ["customer-reservations", customerId],
    queryFn: async () =>
      (await api.get<Paginated<Reservation>>("/reservations/", { params: { guest: customerId } }))
        .data.results,
  });

  if (!customer) return <p className="text-sm text-neutral-500">Loading…</p>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{customer.name || customer.phone}</h1>
        <p className="text-sm text-neutral-500">{customer.phone}</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-neutral-500">Loyalty points</p>
            <p className="text-lg font-semibold">{customer.loyalty_points}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-neutral-500">Credit balance</p>
            <p className="text-lg font-semibold">{formatCurrency(customer.credit_balance)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-neutral-500">Lifetime spend</p>
            <p className="text-lg font-semibold">
              {formatCurrency(
                (invoices ?? [])
                  .filter((i) => i.status !== "VOID")
                  .reduce((sum, i) => sum + parseFloat(i.grand_total), 0)
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Purchase history</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-neutral-100 p-0">
          {invoices?.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between p-4 text-sm">
              <div>
                <p className="font-medium">{inv.display_number ?? "(draft)"}</p>
                <p className="text-xs text-neutral-500">
                  {inv.finalized_at ? new Date(inv.finalized_at).toLocaleDateString() : "not finalized"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={inv.status === "PAID" ? "green" : inv.status === "VOID" ? "neutral" : "yellow"}>
                  {inv.status.replace(/_/g, " ")}
                </Badge>
                <span>{formatCurrency(inv.grand_total)}</span>
              </div>
            </div>
          ))}
          {invoices?.length === 0 && (
            <p className="p-4 text-sm text-neutral-500">No purchases yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stay history</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-neutral-100 p-0">
          {reservations?.map((res) => (
            <div key={res.id} className="flex items-center justify-between p-4 text-sm">
              <span>
                {res.check_in_date} → {res.check_out_date}
              </span>
              <Badge tone={res.status === "CHECKED_OUT" ? "neutral" : "green"}>{res.status}</Badge>
            </div>
          ))}
          {reservations?.length === 0 && (
            <p className="p-4 text-sm text-neutral-500">No stays yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
