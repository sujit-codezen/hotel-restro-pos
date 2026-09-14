"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { PermissionGate } from "@/components/permission-gate";
import { PlusIcon, TagIcon, TrashIcon, XIcon } from "@/components/ui/icons";
import { api } from "@/lib/api";
import { Paginated, useHasPermission } from "@/lib/hooks";
import { cn, formatCurrency } from "@/lib/utils";

type DiscountType = "PERCENT" | "FIXED";
type Discount = { id: string; name: string; type: DiscountType; value: string };

const TYPE_STYLE: Record<DiscountType, { label: string; icon: string }> = {
  PERCENT: { label: "Percent", icon: "bg-emerald-50 text-emerald-600" },
  FIXED: { label: "Fixed amount", icon: "bg-sky-50 text-sky-600" },
};

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

function displayValue(d: Pick<Discount, "type" | "value">) {
  return d.type === "PERCENT" ? `${parseFloat(d.value)}% off` : `${formatCurrency(d.value)} off`;
}

function AddDiscountModal({
  onClose,
  onSubmit,
  submitting,
  error,
}: {
  onClose: () => void;
  onSubmit: (values: { name: string; type: DiscountType; value: string }) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<DiscountType>("PERCENT");
  const [value, setValue] = useState("");
  const valid = name.trim() && value.trim() && parseFloat(value) > 0;

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
            <TagIcon className="h-5 w-5" />
          </span>
          <p className="flex-1 font-semibold text-neutral-900">Add a discount</p>
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
            <label className="mb-1 block text-xs font-medium text-neutral-400">Name</label>
            <input
              autoFocus
              placeholder="e.g. Happy Hour"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">Type</label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(TYPE_STYLE) as DiscountType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={cn(
                    "rounded-xl border py-2 text-xs font-medium transition-colors",
                    type === t
                      ? "border-[#E5484D] bg-[#FDECEC] text-[#E5484D]"
                      : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                  )}
                >
                  {TYPE_STYLE[t].label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">Value</label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-neutral-400">
                {type === "PERCENT" ? "%" : "Rs."}
              </span>
              <input
                type="number"
                min="0"
                max={type === "PERCENT" ? 100 : undefined}
                step="0.01"
                placeholder={type === "PERCENT" ? "10" : "150"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="h-10 w-full rounded-xl border border-neutral-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-[#E5484D]"
              />
            </div>
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
            onClick={() => valid && onSubmit({ name: name.trim(), type, value })}
            disabled={!valid || submitting}
            className="flex-1 rounded-xl bg-[#E5484D] py-2.5 text-sm font-medium text-white hover:bg-[#D6393E] disabled:opacity-60"
          >
            {submitting ? "Adding…" : "Add discount"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DiscountCard({ discount, onDelete, deleting }: { discount: Discount; onDelete: () => void; deleting: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const style = TYPE_STYLE[discount.type];

  if (confirming) {
    return (
      <div className="flex flex-col justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm">
        <p className="text-sm text-red-700">Remove “{discount.name}”? Staff won&apos;t be able to apply it anymore.</p>
        <div className="flex gap-2">
          <button
            onClick={() => setConfirming(false)}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-white"
          >
            Cancel
          </button>
          <button
            onClick={onDelete}
            disabled={deleting}
            className="flex-1 rounded-lg bg-red-600 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {deleting ? "Removing…" : "Remove"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", style.icon)}>
        <TagIcon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1 pr-6">
        <p className="truncate text-sm font-semibold text-neutral-900">{discount.name}</p>
        <p className="mt-0.5 truncate text-sm text-neutral-500">{displayValue(discount)}</p>
      </div>
      <button
        onClick={() => setConfirming(true)}
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-neutral-300 opacity-0 transition-opacity hover:bg-neutral-50 hover:text-red-500 group-hover:opacity-100"
        aria-label="Remove discount"
      >
        <TrashIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function DiscountsPage() {
  const canManageDiscounts = useHasPermission("can_manage_discounts");
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const { data: discounts, isLoading } = useQuery<Discount[]>({
    queryKey: ["discounts"],
    queryFn: async () => (await api.get<Paginated<Discount>>("/discounts/")).data.results,
  });

  const createDiscount = useMutation({
    mutationFn: async (values: { name: string; type: DiscountType; value: string }) =>
      api.post("/discounts/", values),
    onSuccess: () => {
      setShowAdd(false);
      setAddError(null);
      queryClient.invalidateQueries({ queryKey: ["discounts"] });
    },
    onError: (err: unknown) => setAddError(errorMessage(err, "Could not add that discount.")),
  });

  const deleteDiscount = useMutation({
    mutationFn: async (id: string) => api.delete(`/discounts/${id}/`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["discounts"] }),
  });

  return (
    <PermissionGate allowed={canManageDiscounts}>
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Discounts</h1>
            {!isLoading && discounts && discounts.length > 0 && (
              <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-500">
                {discounts.length}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-neutral-500">
            Set up percent or fixed discounts your staff can apply at checkout.
          </p>
        </div>

        <button
          onClick={() => {
            setAddError(null);
            setShowAdd(true);
          }}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-[#E5484D] px-4 text-sm font-medium text-white shadow-sm shadow-[#E5484D]/20 transition-all hover:-translate-y-px hover:bg-[#D6393E] hover:shadow-md hover:shadow-[#E5484D]/30"
        >
          <PlusIcon className="h-4 w-4" /> Add discount
        </button>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[76px] animate-pulse rounded-2xl bg-neutral-100" />
          ))}
        </div>
      )}

      {!isLoading && discounts && discounts.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {discounts.map((d) => (
            <DiscountCard
              key={d.id}
              discount={d}
              onDelete={() => deleteDiscount.mutate(d.id)}
              deleting={deleteDiscount.isPending && deleteDiscount.variables === d.id}
            />
          ))}
        </div>
      )}

      {!isLoading && discounts?.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/50 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-neutral-300 shadow-sm">
            <TagIcon className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-medium text-neutral-700">No discounts yet</p>
            <p className="mt-0.5 text-xs text-neutral-400">Add one to start offering deals at checkout.</p>
          </div>
          <button
            onClick={() => {
              setAddError(null);
              setShowAdd(true);
            }}
            className="mt-1 flex items-center gap-1.5 rounded-xl bg-[#E5484D] px-4 py-2 text-sm font-medium text-white hover:bg-[#D6393E]"
          >
            <PlusIcon className="h-4 w-4" /> Add discount
          </button>
        </div>
      )}

      {showAdd && (
        <AddDiscountModal
          onClose={() => setShowAdd(false)}
          onSubmit={(values) => createDiscount.mutate(values)}
          submitting={createDiscount.isPending}
          error={addError}
        />
      )}
    </div>
    </PermissionGate>
  );
}
