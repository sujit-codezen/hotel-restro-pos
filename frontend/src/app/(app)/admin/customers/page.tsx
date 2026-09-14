"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { SearchIcon, SparkleIcon, UsersIcon } from "@/components/ui/icons";
import { api } from "@/lib/api";
import { Paginated } from "@/lib/hooks";
import { Customer } from "@/lib/types";
import { cn, nameToGradient } from "@/lib/utils";

export default function CustomersPage() {
  const [search, setSearch] = useState("");

  const { data: customers, isLoading } = useQuery<Customer[]>({
    queryKey: ["customers", search],
    queryFn: async () =>
      (await api.get<Paginated<Customer>>("/customers/", { params: { search } })).data.results,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Customers</h1>
            {!isLoading && customers && customers.length > 0 && (
              <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-500">
                {customers.length}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-neutral-500">
            People who&apos;ve booked, dined, or earned loyalty points with you.
          </p>
        </div>

        <div className="relative sm:w-72">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-neutral-400">
            <SearchIcon className="h-4 w-4" />
          </span>
          <input
            placeholder="Search by name or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-full rounded-xl border border-neutral-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-[#E5484D]"
          />
        </div>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-[68px] animate-pulse rounded-2xl bg-neutral-100" />
          ))}
        </div>
      )}

      {!isLoading && customers && customers.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
          {customers.map((c, i) => (
            <Link
              key={c.id}
              href={`/admin/customers/${c.id}`}
              className={cn(
                "flex items-center gap-3 p-4 transition-colors hover:bg-neutral-50",
                i !== 0 && "border-t border-neutral-100"
              )}
            >
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white/90"
                style={{ background: nameToGradient(c.name || c.phone) }}
              >
                {(c.name || c.phone).charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-900">{c.name || "(no name)"}</p>
                <p className="text-xs text-neutral-500">{c.phone}</p>
              </div>
              {c.loyalty_points > 0 && (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                  <SparkleIcon className="h-3 w-3" /> {c.loyalty_points} pts
                </span>
              )}
            </Link>
          ))}
        </div>
      )}

      {!isLoading && customers?.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/50 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-neutral-300 shadow-sm">
            <UsersIcon className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-medium text-neutral-700">
              {search ? "No customers match that search" : "No customers yet"}
            </p>
            <p className="mt-0.5 text-xs text-neutral-400">
              {search
                ? "Try a different name or phone number."
                : "They're added automatically from a reservation or a POS order."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
