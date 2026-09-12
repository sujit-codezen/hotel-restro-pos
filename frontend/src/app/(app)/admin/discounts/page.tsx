"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { api } from "@/lib/api";
import { Paginated } from "@/lib/hooks";

type Discount = { id: string; name: string; type: "PERCENT" | "FIXED"; value: string };

export default function DiscountsPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [type, setType] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [value, setValue] = useState("");

  const { data: discounts, isLoading } = useQuery<Discount[]>({
    queryKey: ["discounts"],
    queryFn: async () => (await api.get<Paginated<Discount>>("/discounts/")).data.results,
  });

  const createDiscount = useMutation({
    mutationFn: async () => api.post("/discounts/", { name, type, value }),
    onSuccess: () => {
      setName("");
      setValue("");
      queryClient.invalidateQueries({ queryKey: ["discounts"] });
    },
  });

  const deleteDiscount = useMutation({
    mutationFn: async (id: string) => api.delete(`/discounts/${id}/`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["discounts"] }),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Discounts</h1>

      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="text-sm font-medium">Add a discount</p>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && value) createDiscount.mutate();
            }}
          >
            <Input
              placeholder="Name (e.g. Happy Hour)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-48"
            />
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as "PERCENT" | "FIXED")}
              className="w-32"
            >
              <option value="PERCENT">Percent</option>
              <option value="FIXED">Fixed amount</option>
            </Select>
            <Input
              placeholder={type === "PERCENT" ? "e.g. 10" : "e.g. 150"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-28"
            />
            <Button type="submit" variant="secondary" disabled={createDiscount.isPending}>
              Add
            </Button>
          </form>
          <p className="text-xs text-neutral-500">
            Applied per-invoice at checkout, before any payment is recorded.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="divide-y divide-neutral-100 p-0">
          {discounts?.map((d) => (
            <div key={d.id} className="flex items-center justify-between p-4 text-sm">
              <span>{d.name}</span>
              <div className="flex items-center gap-3">
                <span className="text-neutral-500">
                  {d.type === "PERCENT" ? `${d.value}%` : `Rs. ${d.value}`}
                </span>
                <button
                  onClick={() => deleteDiscount.mutate(d.id)}
                  disabled={deleteDiscount.isPending}
                  className="text-xs text-neutral-400 hover:text-red-500 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          {discounts?.length === 0 && !isLoading && (
            <p className="p-4 text-sm text-neutral-500">No discounts yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
