"use client";

import { useQuery } from "@tanstack/react-query";

import { PermissionGate } from "@/components/permission-gate";
import { ChartIcon, DoorIcon, ReceiptIcon, TagIcon, UsersIcon, UtensilsIcon } from "@/components/ui/icons";
import { api } from "@/lib/api";
import { useHasPermission, useStores } from "@/lib/hooks";
import { formatCurrency } from "@/lib/utils";

type DailySales = { finalized_at__date: string; total: number; count: number };
type BestSelling = { description: string; quantity_sold: number };
type PaymentMethod = { method: string; total: number; count: number };
type TaxRow = { date: string; tax_collected: number };
type StaffRow = { staff_id: string; staff_name: string; total_collected: number; payment_count: number };
type PropertyRow = {
  store_id: string;
  store_name: string;
  total_sales: number;
  order_count: number;
  items_sold: number;
};

function ReportCard({
  icon,
  title,
  isLoading,
  isEmpty,
  emptyMessage,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  isLoading: boolean;
  isEmpty: boolean;
  emptyMessage: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-neutral-100 p-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FDECEC] text-[#E5484D]">
          {icon}
        </span>
        <p className="text-sm font-semibold text-neutral-900">{title}</p>
      </div>
      <div className="space-y-2 p-4 text-sm">
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-4 animate-pulse rounded bg-neutral-100" />
            ))}
          </div>
        )}
        {!isLoading && isEmpty && <p className="text-neutral-400">{emptyMessage}</p>}
        {!isLoading && !isEmpty && children}
      </div>
    </div>
  );
}

function ReportRow({ label, sub, value }: { label: string; sub?: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 truncate text-neutral-700">
        {label}
        {sub && <span className="ml-1.5 text-xs text-neutral-400">{sub}</span>}
      </span>
      <span className="shrink-0 font-medium text-neutral-900">{value}</span>
    </div>
  );
}

export default function AdminReportsPage() {
  const canViewReports = useHasPermission("can_view_reports");
  const daily = useQuery<DailySales[]>({
    queryKey: ["report-sales-daily"],
    queryFn: async () => (await api.get("/reports/sales-daily/")).data,
  });
  const bestSelling = useQuery<BestSelling[]>({
    queryKey: ["report-best-selling"],
    queryFn: async () => (await api.get("/reports/best-selling-items/")).data,
  });
  const paymentMethods = useQuery<PaymentMethod[]>({
    queryKey: ["report-payment-methods"],
    queryFn: async () => (await api.get("/reports/payment-methods/")).data,
  });
  const tax = useQuery<TaxRow[]>({
    queryKey: ["report-tax"],
    queryFn: async () => (await api.get("/reports/tax/")).data,
  });
  const staffPerformance = useQuery<StaffRow[]>({
    queryKey: ["report-staff-performance"],
    queryFn: async () => (await api.get("/reports/staff-performance/")).data,
  });
  const byProperty = useQuery<PropertyRow[]>({
    queryKey: ["report-by-property"],
    queryFn: async () => (await api.get("/reports/by-property/")).data,
  });
  const { data: stores } = useStores();
  const isMultiProperty = (stores?.length ?? 0) > 1;

  const totalTaxCollected = (tax.data ?? []).reduce((sum, row) => sum + row.tax_collected, 0);

  return (
    <PermissionGate allowed={canViewReports}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Reports</h1>
          <p className="mt-0.5 text-sm text-neutral-500">Sales, tax, and staff performance for the last 30 days.</p>
        </div>

        {isMultiProperty && (
          <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div className="flex items-center gap-2.5 border-b border-neutral-100 p-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FDECEC] text-[#E5484D]">
                <DoorIcon className="h-4 w-4" />
              </span>
              <p className="text-sm font-semibold text-neutral-900">By property</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-neutral-400">
                    <th className="px-4 py-2 font-medium">Store</th>
                    <th className="px-4 py-2 font-medium">Orders</th>
                    <th className="px-4 py-2 font-medium">Items sold</th>
                    <th className="px-4 py-2 text-right font-medium">Sales</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-50">
                  {byProperty.data?.map((row) => (
                    <tr key={row.store_id}>
                      <td className="px-4 py-2.5 font-medium text-neutral-900">{row.store_name}</td>
                      <td className="px-4 py-2.5 text-neutral-600">{row.order_count}</td>
                      <td className="px-4 py-2.5 text-neutral-600">{row.items_sold}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-neutral-900">
                        {formatCurrency(row.total_sales)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {byProperty.data?.length === 0 && (
                <p className="p-4 text-sm text-neutral-400">No sales yet at any property.</p>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ReportCard
            icon={<ChartIcon className="h-4 w-4" />}
            title="Daily sales"
            isLoading={daily.isLoading}
            isEmpty={daily.data?.length === 0}
            emptyMessage="No sales yet."
          >
            {daily.data?.map((row) => (
              <ReportRow key={row.finalized_at__date} label={row.finalized_at__date} value={formatCurrency(row.total)} />
            ))}
          </ReportCard>

          <ReportCard
            icon={<UtensilsIcon className="h-4 w-4" />}
            title="Best-selling items"
            isLoading={bestSelling.isLoading}
            isEmpty={bestSelling.data?.length === 0}
            emptyMessage="No sales yet."
          >
            {bestSelling.data?.map((row) => (
              <ReportRow key={row.description} label={row.description} value={String(row.quantity_sold)} />
            ))}
          </ReportCard>

          <ReportCard
            icon={<ReceiptIcon className="h-4 w-4" />}
            title="Payment methods"
            isLoading={paymentMethods.isLoading}
            isEmpty={paymentMethods.data?.length === 0}
            emptyMessage="No payments yet."
          >
            {paymentMethods.data?.map((row) => (
              <ReportRow key={row.method} label={row.method.replace(/_/g, " ")} value={formatCurrency(row.total)} />
            ))}
          </ReportCard>

          <ReportCard
            icon={<TagIcon className="h-4 w-4" />}
            title="Tax / VAT collected"
            isLoading={tax.isLoading}
            isEmpty={tax.data?.length === 0}
            emptyMessage="No tax collected — add a tax class in Menu and assign it to items to start tracking VAT."
          >
            {tax.data && tax.data.length > 0 && (
              <div className="flex items-center justify-between border-b border-neutral-100 pb-2 font-medium text-neutral-900">
                <span>Total</span>
                <span>{formatCurrency(totalTaxCollected)}</span>
              </div>
            )}
            {tax.data?.map((row) => <ReportRow key={row.date} label={row.date} value={formatCurrency(row.tax_collected)} />)}
          </ReportCard>

          <ReportCard
            icon={<UsersIcon className="h-4 w-4" />}
            title="Staff performance"
            isLoading={staffPerformance.isLoading}
            isEmpty={staffPerformance.data?.length === 0}
            emptyMessage="No payments recorded by staff yet."
          >
            {staffPerformance.data?.map((row) => (
              <ReportRow
                key={row.staff_id}
                label={row.staff_name}
                sub={`(${row.payment_count})`}
                value={formatCurrency(row.total_collected)}
              />
            ))}
          </ReportCard>
        </div>
      </div>
    </PermissionGate>
  );
}
