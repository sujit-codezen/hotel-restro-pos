"use client";

import { useQuery } from "@tanstack/react-query";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { useStores } from "@/lib/hooks";
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

export default function AdminReportsPage() {
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
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Reports</h1>

      {isMultiProperty && (
        <Card>
          <CardHeader>
            <CardTitle>By property (last 30 days)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-neutral-500">
                  <th className="px-4 py-2 font-normal">Store</th>
                  <th className="px-4 py-2 font-normal">Orders</th>
                  <th className="px-4 py-2 font-normal">Items sold</th>
                  <th className="px-4 py-2 text-right font-normal">Sales</th>
                </tr>
              </thead>
              <tbody>
                {byProperty.data?.map((row) => (
                  <tr key={row.store_id} className="border-b border-neutral-50 last:border-0">
                    <td className="px-4 py-2 font-medium">{row.store_name}</td>
                    <td className="px-4 py-2">{row.order_count}</td>
                    <td className="px-4 py-2">{row.items_sold}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(row.total_sales)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {byProperty.data?.length === 0 && (
              <p className="p-4 text-sm text-neutral-500">No sales yet at any property.</p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Daily sales</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {daily.data?.map((row) => (
              <div key={row.finalized_at__date} className="flex justify-between">
                <span>{row.finalized_at__date}</span>
                <span>{formatCurrency(row.total)}</span>
              </div>
            ))}
            {daily.data?.length === 0 && <p className="text-neutral-500">No sales yet.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Best-selling items</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {bestSelling.data?.map((row) => (
              <div key={row.description} className="flex justify-between">
                <span>{row.description}</span>
                <span>{row.quantity_sold}</span>
              </div>
            ))}
            {bestSelling.data?.length === 0 && <p className="text-neutral-500">No sales yet.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment methods</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {paymentMethods.data?.map((row) => (
              <div key={row.method} className="flex justify-between">
                <span>{row.method}</span>
                <span>{formatCurrency(row.total)}</span>
              </div>
            ))}
            {paymentMethods.data?.length === 0 && <p className="text-neutral-500">No payments yet.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tax / VAT collected</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {tax.data && tax.data.length > 0 && (
              <div className="flex justify-between border-b border-neutral-100 pb-1 font-medium">
                <span>Total (last 30 days)</span>
                <span>{formatCurrency(totalTaxCollected)}</span>
              </div>
            )}
            {tax.data?.map((row) => (
              <div key={row.date} className="flex justify-between">
                <span>{row.date}</span>
                <span>{formatCurrency(row.tax_collected)}</span>
              </div>
            ))}
            {tax.data?.length === 0 && (
              <p className="text-neutral-500">
                No tax collected — add a tax class in Menu and assign it to items to start
                tracking VAT.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Staff performance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {staffPerformance.data?.map((row) => (
              <div key={row.staff_id} className="flex justify-between">
                <span>
                  {row.staff_name} <span className="text-neutral-400">({row.payment_count})</span>
                </span>
                <span>{formatCurrency(row.total_collected)}</span>
              </div>
            ))}
            {staffPerformance.data?.length === 0 && (
              <p className="text-neutral-500">No payments recorded by staff yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
