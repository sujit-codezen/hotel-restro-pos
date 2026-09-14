"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";

import { BedIcon, ChartIcon, ReceiptIcon, SparkleIcon } from "@/components/ui/icons";
import { api } from "@/lib/api";
import { Paginated } from "@/lib/hooks";
import { Customer, InvoiceT, Reservation } from "@/lib/types";
import { cn, formatCurrency, nameToGradient } from "@/lib/utils";

const INVOICE_STYLE: Record<InvoiceT["status"], { label: string; pill: string; dot: string }> = {
  PAID: { label: "Paid", pill: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  PARTIALLY_PAID: { label: "Partially paid", pill: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  UNPAID: { label: "Unpaid", pill: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  DRAFT: { label: "Draft", pill: "bg-neutral-100 text-neutral-600", dot: "bg-neutral-400" },
  VOID: { label: "Void", pill: "bg-red-50 text-red-600", dot: "bg-red-400" },
};

const RESERVATION_STYLE: Record<Reservation["status"], { label: string; pill: string; dot: string }> = {
  BOOKED: { label: "Booked", pill: "bg-sky-50 text-sky-700", dot: "bg-sky-500" },
  CHECKED_IN: { label: "Checked in", pill: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  CHECKED_OUT: { label: "Checked out", pill: "bg-neutral-100 text-neutral-600", dot: "bg-neutral-400" },
  CANCELLED: { label: "Cancelled", pill: "bg-red-50 text-red-600", dot: "bg-red-400" },
  NO_SHOW: { label: "No-show", pill: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
};

function StatusPill({ style }: { style: { label: string; pill: string; dot: string } }) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", style.pill)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
      {style.label}
    </span>
  );
}

function StatCard({
  icon,
  iconClass,
  label,
  value,
}: {
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", iconClass)}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-lg font-semibold leading-tight text-neutral-900">{value}</p>
        <p className="text-xs text-neutral-500">{label}</p>
      </div>
    </div>
  );
}

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

  if (!customer) {
    return (
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <div className="h-24 animate-pulse rounded-2xl bg-neutral-100" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[76px] animate-pulse rounded-2xl bg-neutral-100" />
          ))}
        </div>
        <div className="space-y-6">
          <div className="h-40 animate-pulse rounded-2xl bg-neutral-100" />
          <div className="h-40 animate-pulse rounded-2xl bg-neutral-100" />
        </div>
      </div>
    );
  }

  const lifetimeSpend = (invoices ?? [])
    .filter((i) => i.status !== "VOID")
    .reduce((sum, i) => sum + parseFloat(i.grand_total), 0);

  return (
    <div className="space-y-6">
      <Link href="/admin/customers" className="text-sm text-neutral-400 hover:text-neutral-600">
        ← Customers
      </Link>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[340px_1fr]">
        {/* Left: who they are + the numbers that matter at a glance, kept
           in view while the history lists on the right scroll — same
           sticky-sidebar pattern as the Folio page. */}
        <div className="min-w-0">
          <div className="space-y-4 xl:sticky xl:top-6">
            <div className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
              <span
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-xl font-semibold text-white/90"
                style={{ background: nameToGradient(customer.name || customer.phone) }}
              >
                {(customer.name || customer.phone).charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-semibold tracking-tight text-neutral-900">
                  {customer.name || customer.phone}
                </h1>
                <p className="mt-0.5 truncate text-sm text-neutral-500">
                  {customer.phone}
                  {customer.email && <span className="text-neutral-300"> · </span>}
                  {customer.email}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <StatCard
                icon={<SparkleIcon className="h-5 w-5" />}
                iconClass="bg-amber-50 text-amber-600"
                label="Loyalty points"
                value={String(customer.loyalty_points)}
              />
              <StatCard
                icon={<ReceiptIcon className="h-5 w-5" />}
                iconClass="bg-emerald-50 text-emerald-600"
                label="Credit balance"
                value={formatCurrency(customer.credit_balance)}
              />
              <StatCard
                icon={<ChartIcon className="h-5 w-5" />}
                iconClass="bg-sky-50 text-sky-600"
                label="Lifetime spend"
                value={formatCurrency(lifetimeSpend)}
              />
            </div>
          </div>
        </div>

        {/* Right: history lists, given the room to breathe the old single
           narrow column never had. */}
        <div className="min-w-0 space-y-6">
          <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <p className="border-b border-neutral-100 p-4 text-sm font-medium text-neutral-500">Purchase history</p>
            <div className="divide-y divide-neutral-100">
              {invoices?.map((inv) => (
                <div key={inv.id} className="flex items-center gap-3 p-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-400">
                    <ReceiptIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-900">
                      {inv.display_number ?? "(draft)"}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {inv.finalized_at ? new Date(inv.finalized_at).toLocaleDateString() : "not finalized"}
                    </p>
                  </div>
                  <StatusPill style={INVOICE_STYLE[inv.status]} />
                  <span className="w-24 shrink-0 text-right text-sm font-medium text-neutral-900">
                    {formatCurrency(inv.grand_total)}
                  </span>
                </div>
              ))}
              {invoices?.length === 0 && <p className="p-4 text-sm text-neutral-400">No purchases yet.</p>}
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <p className="border-b border-neutral-100 p-4 text-sm font-medium text-neutral-500">Stay history</p>
            <div className="divide-y divide-neutral-100">
              {reservations?.map((res) => (
                <div key={res.id} className="flex items-center gap-3 p-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-400">
                    <BedIcon className="h-4 w-4" />
                  </span>
                  <span className="flex-1 text-sm text-neutral-700">
                    {res.check_in_date} → {res.check_out_date}
                  </span>
                  <StatusPill style={RESERVATION_STYLE[res.status]} />
                </div>
              ))}
              {reservations?.length === 0 && <p className="p-4 text-sm text-neutral-400">No stays yet.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
