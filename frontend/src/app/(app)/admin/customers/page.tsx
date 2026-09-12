"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { Paginated } from "@/lib/hooks";
import { Customer } from "@/lib/types";

export default function CustomersPage() {
  const [search, setSearch] = useState("");

  const { data: customers, isLoading } = useQuery<Customer[]>({
    queryKey: ["customers", search],
    queryFn: async () =>
      (await api.get<Paginated<Customer>>("/customers/", { params: { search } })).data.results,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Customers</h1>
        <Input
          placeholder="Search by phone or name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
      </div>

      {isLoading && <p className="text-sm text-neutral-500">Loading…</p>}

      <Card>
        <CardContent className="divide-y divide-neutral-100 p-0">
          {customers?.map((c) => (
            <Link
              key={c.id}
              href={`/admin/customers/${c.id}`}
              className="flex items-center justify-between p-4 text-sm hover:bg-neutral-50"
            >
              <div>
                <p className="font-medium">{c.name || "(no name)"}</p>
                <p className="text-xs text-neutral-500">{c.phone}</p>
              </div>
              {c.loyalty_points > 0 && (
                <span className="text-xs text-neutral-500">{c.loyalty_points} pts</span>
              )}
            </Link>
          ))}
          {customers?.length === 0 && !isLoading && (
            <p className="p-4 text-sm text-neutral-500">
              No customers yet — they're added from a reservation or a POS order.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
