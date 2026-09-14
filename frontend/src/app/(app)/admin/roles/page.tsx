"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { PermissionGate } from "@/components/permission-gate";
import { PlusIcon, ShieldIcon, TrashIcon, XIcon } from "@/components/ui/icons";
import { api } from "@/lib/api";
import { Paginated, useHasPermission } from "@/lib/hooks";
import { cn } from "@/lib/utils";

const PERMISSION_FLAGS = [
  { key: "can_refund_or_void", label: "Refund / void invoices" },
  { key: "can_manage_staff", label: "Manage staff & roles" },
  { key: "can_access_settings", label: "Access settings" },
  { key: "can_manage_menu", label: "Manage menu" },
  { key: "can_manage_discounts", label: "Manage discounts" },
  { key: "can_view_reports", label: "View reports" },
] as const;

type Role = {
  id: string;
  name: string;
  is_system: boolean;
} & Record<(typeof PERMISSION_FLAGS)[number]["key"], boolean>;

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

function Switch({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      role="switch"
      aria-checked={on}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50",
        on ? "bg-[#E5484D]" : "bg-neutral-200"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
          on ? "translate-x-[18px]" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

function AddRoleModal({
  onClose,
  onSubmit,
  submitting,
  error,
}: {
  onClose: () => void;
  onSubmit: (name: string) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [name, setName] = useState("");

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
            <ShieldIcon className="h-5 w-5" />
          </span>
          <p className="flex-1 font-semibold text-neutral-900">Add a role</p>
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
              placeholder="e.g. Shift Lead"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
            />
          </div>
          <p className="text-xs text-neutral-400">Set what this role can do afterward from its card.</p>
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
            onClick={() => name.trim() && onSubmit(name.trim())}
            disabled={!name.trim() || submitting}
            className="flex-1 rounded-xl bg-[#E5484D] py-2.5 text-sm font-medium text-white hover:bg-[#D6393E] disabled:opacity-60"
          >
            {submitting ? "Adding…" : "Add role"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RoleCard({
  role,
  onTogglePermission,
  togglingKey,
  onDelete,
  deleting,
  deleteError,
}: {
  role: Role;
  onTogglePermission: (flag: string) => void;
  togglingKey: string | null;
  onDelete: () => void;
  deleting: boolean;
  deleteError: string | null;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-neutral-900">{role.name}</p>
          {role.is_system && (
            <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] font-medium text-neutral-500">
              Default
            </span>
          )}
        </div>
        {!confirming && (
          <button
            onClick={() => setConfirming(true)}
            className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-300 hover:bg-neutral-50 hover:text-red-500"
            aria-label={`Delete ${role.name}`}
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {confirming ? (
        <div className="mt-3 space-y-2 rounded-xl bg-red-50 p-3">
          <p className="text-sm text-red-700">Delete this role? Staff still assigned to it must be reassigned first.</p>
          {deleteError && <p className="text-xs text-red-600">{deleteError}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => setConfirming(false)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-white"
            >
              Keep it
            </button>
            <button
              onClick={onDelete}
              disabled={deleting}
              className="flex-1 rounded-lg bg-red-600 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {deleting ? "Deleting…" : "Yes, delete"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2">
          {PERMISSION_FLAGS.map((flag) => (
            <label key={flag.key} className="flex items-center justify-between gap-3 text-sm text-neutral-700">
              {flag.label}
              <Switch
                on={role[flag.key]}
                onClick={() => onTogglePermission(flag.key)}
                disabled={togglingKey === flag.key}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RolesPage() {
  const canManageStaff = useHasPermission("can_manage_staff");
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string | null>>({});

  const { data: roles, isLoading } = useQuery<Role[]>({
    queryKey: ["roles"],
    queryFn: async () => (await api.get<Paginated<Role>>("/roles/")).data.results,
  });

  const createRole = useMutation({
    mutationFn: async (name: string) => api.post("/roles/", { name }),
    onSuccess: () => {
      setShowAdd(false);
      setAddError(null);
      queryClient.invalidateQueries({ queryKey: ["roles"] });
    },
    onError: (err: unknown) => setAddError(errorMessage(err, "Could not add that role.")),
  });

  const togglePermission = useMutation({
    mutationFn: async ({ role, flag }: { role: Role; flag: string }) =>
      api.patch(`/roles/${role.id}/`, { [flag]: !role[flag as keyof Role] }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["roles"] }),
  });

  const deleteRole = useMutation({
    mutationFn: async (id: string) => api.delete(`/roles/${id}/`),
    onSuccess: (_data, id) => {
      setDeleteErrors((prev) => ({ ...prev, [id]: null }));
      queryClient.invalidateQueries({ queryKey: ["roles"] });
    },
    onError: (err: unknown, id) =>
      setDeleteErrors((prev) => ({ ...prev, [id]: errorMessage(err, "Could not delete role.") })),
  });

  return (
    <PermissionGate allowed={canManageStaff}>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Roles</h1>
            <p className="mt-0.5 text-sm text-neutral-500">
              Control what each role can do. Basic operations (taking orders, billing, holding a
              table) are open to everyone — these toggles only gate the sensitive actions.
            </p>
          </div>

          <button
            onClick={() => {
              setAddError(null);
              setShowAdd(true);
            }}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-[#E5484D] px-4 text-sm font-medium text-white shadow-sm shadow-[#E5484D]/20 transition-all hover:-translate-y-px hover:bg-[#D6393E] hover:shadow-md hover:shadow-[#E5484D]/30"
          >
            <PlusIcon className="h-4 w-4" /> Add role
          </button>
        </div>

        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl bg-neutral-100" />
            ))}
          </div>
        )}

        <div className="space-y-3">
          {roles?.map((role) => (
            <RoleCard
              key={role.id}
              role={role}
              onTogglePermission={(flag) => togglePermission.mutate({ role, flag })}
              togglingKey={
                togglePermission.isPending && togglePermission.variables?.role.id === role.id
                  ? togglePermission.variables.flag
                  : null
              }
              onDelete={() => deleteRole.mutate(role.id)}
              deleting={deleteRole.isPending && deleteRole.variables === role.id}
              deleteError={deleteErrors[role.id] ?? null}
            />
          ))}
        </div>

        {!isLoading && roles?.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/50 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-neutral-300 shadow-sm">
              <ShieldIcon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-medium text-neutral-700">No roles yet</p>
              <p className="mt-0.5 text-xs text-neutral-400">Add a role before inviting staff.</p>
            </div>
            <button
              onClick={() => {
                setAddError(null);
                setShowAdd(true);
              }}
              className="mt-1 flex items-center gap-1.5 rounded-xl bg-[#E5484D] px-4 py-2 text-sm font-medium text-white hover:bg-[#D6393E]"
            >
              <PlusIcon className="h-4 w-4" /> Add role
            </button>
          </div>
        )}

        {showAdd && (
          <AddRoleModal
            onClose={() => setShowAdd(false)}
            onSubmit={(name) => createRole.mutate(name)}
            submitting={createRole.isPending}
            error={addError}
          />
        )}
      </div>
    </PermissionGate>
  );
}
