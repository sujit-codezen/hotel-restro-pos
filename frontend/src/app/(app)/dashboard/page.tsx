"use client";

import { useQuery } from "@tanstack/react-query";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { DashboardSummary } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

export default function DashboardPage() {
  const { data, isLoading } = useQuery<DashboardSummary>({
    queryKey: ["dashboard-summary"],
    queryFn: async () => (await api.get("/dashboard/summary/")).data,
    refetchInterval: 30_000,
  });

  const cards = [
    { label: "Today's sales", value: data ? formatCurrency(data.todays_sales) : "—" },
    { label: "Today's orders", value: data?.todays_orders ?? "—" },
    { label: "Items sold", value: data?.items_sold ?? "—" },
    { label: "Pending credit", value: data ? formatCurrency(data.pending_credit) : "—" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader>
              <CardTitle>{c.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{isLoading ? "…" : c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
