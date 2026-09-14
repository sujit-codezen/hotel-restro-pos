"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { PermissionGate } from "@/components/permission-gate";
import { CheckIcon, GearIcon } from "@/components/ui/icons";
import { api } from "@/lib/api";
import { useHasPermission } from "@/lib/hooks";
import { Organization } from "@/lib/types";

const BUSINESS_TYPE_LABEL: Record<Organization["business_type"], string> = {
  RESTAURANT: "Restaurant",
  HOTEL: "Hotel",
  HOTEL_RESTAURANT: "Hotel + Restaurant",
};

const inputClass =
  "h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]";

export default function AdminSettingsPage() {
  const canAccessSettings = useHasPermission("can_access_settings");
  const queryClient = useQueryClient();
  const { data: org, isLoading } = useQuery<Organization>({
    queryKey: ["organization"],
    queryFn: async () => (await api.get("/org/")).data,
  });

  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("");
  const [timezone, setTimezone] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (org) {
      setName(org.name);
      setCurrency(org.currency);
      setTimezone(org.timezone);
    }
  }, [org]);

  const save = useMutation({
    mutationFn: async () => api.patch("/org/", { name, currency, timezone }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const dirty = !!org && (name !== org.name || currency !== org.currency || timezone !== org.timezone);

  return (
    <PermissionGate allowed={canAccessSettings}>
      <div className="mx-auto max-w-xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Settings</h1>
          <p className="mt-0.5 text-sm text-neutral-500">Business details used across receipts and reports.</p>
        </div>

        {isLoading && (
          <div className="space-y-4">
            <div className="h-10 animate-pulse rounded-xl bg-neutral-100" />
            <div className="h-10 animate-pulse rounded-xl bg-neutral-100" />
            <div className="h-10 animate-pulse rounded-xl bg-neutral-100" />
          </div>
        )}

        {org && (
          <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div className="flex items-center gap-3 border-b border-neutral-100 p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FDECEC] text-[#E5484D]">
                <GearIcon className="h-5 w-5" />
              </span>
              <p className="font-semibold text-neutral-900">Business details</p>
            </div>

            <div className="space-y-4 p-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-400">Business name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-400">Currency</label>
                  <input value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-400">Timezone</label>
                  <input value={timezone} onChange={(e) => setTimezone(e.target.value)} className={inputClass} />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-400">Business type</label>
                <p className="flex h-10 items-center rounded-xl bg-neutral-50 px-3 text-sm text-neutral-600">
                  {BUSINESS_TYPE_LABEL[org.business_type]}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 border-t border-neutral-100 p-4">
              <button
                onClick={() => save.mutate()}
                disabled={!dirty || save.isPending}
                className="rounded-xl bg-[#E5484D] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#D6393E] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {save.isPending ? "Saving…" : "Save changes"}
              </button>
              {saved && (
                <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
                  <CheckIcon className="h-4 w-4" /> Saved
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </PermissionGate>
  );
}
