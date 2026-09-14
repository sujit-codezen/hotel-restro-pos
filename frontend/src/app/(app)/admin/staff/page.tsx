"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { PermissionGate } from "@/components/permission-gate";
import { EditIcon, PlusIcon, TrashIcon, UsersIcon, XIcon } from "@/components/ui/icons";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { Paginated, useHasPermission } from "@/lib/hooks";
import { cn, nameToGradient } from "@/lib/utils";

type StaffRow = {
  id: string;
  user: string;
  user_email: string;
  user_name: string | null;
  store: string;
  role: string;
  role_name: string;
  is_active: boolean;
};
type RoleOption = { id: string; name: string };

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

function InviteStaffModal({
  roles,
  onClose,
  onSubmit,
  submitting,
  error,
}: {
  roles: RoleOption[];
  onClose: () => void;
  onSubmit: (values: { email: string; firstName: string; password: string; roleId: string }) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState("");
  const valid = email.trim() && password.length >= 8 && roleId;

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
            <UsersIcon className="h-5 w-5" />
          </span>
          <p className="flex-1 font-semibold text-neutral-900">Invite staff</p>
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
              placeholder="e.g. Maya Gurung"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">Email</label>
            <input
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">Temporary password</label>
            <input
              type="password"
              minLength={8}
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">Role</label>
            <select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
            >
              <option value="">Select role…</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
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
            onClick={() => valid && onSubmit({ email: email.trim(), firstName: firstName.trim(), password, roleId })}
            disabled={!valid || submitting}
            className="flex-1 rounded-xl bg-[#E5484D] py-2.5 text-sm font-medium text-white hover:bg-[#D6393E] disabled:opacity-60"
          >
            {submitting ? "Adding…" : "Add to store"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditStaffModal({
  staffMember,
  roles,
  onClose,
  onSubmit,
  submitting,
  error,
}: {
  staffMember: StaffRow;
  roles: RoleOption[];
  onClose: () => void;
  onSubmit: (roleId: string) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [roleId, setRoleId] = useState(staffMember.role);
  const displayName = staffMember.user_name || staffMember.user_email;

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
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white/90"
            style={{ background: nameToGradient(displayName) }}
          >
            {displayName.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-neutral-900">{displayName}</p>
            <p className="truncate text-xs text-neutral-400">{staffMember.user_email}</p>
          </div>
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
            <label className="mb-1 block text-xs font-medium text-neutral-400">Role</label>
            <select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
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
            onClick={() => onSubmit(roleId)}
            disabled={roleId === staffMember.role || submitting}
            className="flex-1 rounded-xl bg-[#E5484D] py-2.5 text-sm font-medium text-white hover:bg-[#D6393E] disabled:opacity-60"
          >
            {submitting ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StaffCard({
  staffMember,
  onEdit,
  onToggleActive,
  toggling,
  onRemove,
  removing,
}: {
  staffMember: StaffRow;
  onEdit: () => void;
  onToggleActive: () => void;
  toggling: boolean;
  onRemove: () => void;
  removing: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const displayName = staffMember.user_name || staffMember.user_email;

  if (confirming) {
    return (
      <div className="flex flex-col justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm">
        <p className="text-sm text-red-700">
          Remove {displayName} from this store? They&apos;ll lose access immediately.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setConfirming(false)}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-white"
          >
            Cancel
          </button>
          <button
            onClick={onRemove}
            disabled={removing}
            className="flex-1 rounded-lg bg-red-600 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {removing ? "Removing…" : "Remove"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <span
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white/90"
        style={{ background: nameToGradient(displayName) }}
      >
        {displayName.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-neutral-900">{displayName}</p>
        <p className="truncate text-xs text-neutral-400">
          {staffMember.user_name ? staffMember.user_email : staffMember.role_name}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {staffMember.user_name && (
          <span className="hidden rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] font-medium text-neutral-600 sm:inline">
            {staffMember.role_name}
          </span>
        )}
        <button
          onClick={onEdit}
          className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
          aria-label={`Edit ${displayName}'s role`}
        >
          <EditIcon className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onToggleActive}
          disabled={toggling}
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50",
            staffMember.is_active
              ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
          )}
        >
          {staffMember.is_active ? "Active" : "Inactive"}
        </button>
      </div>
      <button
        onClick={() => setConfirming(true)}
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-neutral-300 opacity-0 transition-opacity hover:bg-neutral-50 hover:text-red-500 group-hover:opacity-100"
        aria-label="Remove staff member"
      >
        <TrashIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function AdminStaffPage() {
  const canManageStaff = useHasPermission("can_manage_staff");
  const storeId = useAuthStore((s) => s.activeStoreId);
  const queryClient = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [editingStaff, setEditingStaff] = useState<StaffRow | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const { data: staff, isLoading } = useQuery<StaffRow[]>({
    queryKey: ["staff"],
    queryFn: async () => (await api.get<Paginated<StaffRow>>("/staff/")).data.results,
  });

  const { data: roles } = useQuery<RoleOption[]>({
    queryKey: ["roles"],
    queryFn: async () => (await api.get<Paginated<RoleOption>>("/roles/")).data.results,
  });

  const invite = useMutation({
    mutationFn: async (values: { email: string; firstName: string; password: string; roleId: string }) =>
      api.post("/staff/invite/", {
        email: values.email,
        password: values.password,
        first_name: values.firstName,
        store: storeId,
        role: values.roleId,
      }),
    onSuccess: () => {
      setShowInvite(false);
      setInviteError(null);
      queryClient.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (err: unknown) =>
      setInviteError(errorMessage(err, "Could not create staff account — check the email/password.")),
  });

  const toggleActive = useMutation({
    mutationFn: async (s: StaffRow) => api.patch(`/staff/${s.id}/`, { is_active: !s.is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff"] }),
  });

  const updateRole = useMutation({
    mutationFn: async ({ s, roleId }: { s: StaffRow; roleId: string }) =>
      api.patch(`/staff/${s.id}/`, { role: roleId }),
    onSuccess: () => {
      setEditingStaff(null);
      setEditError(null);
      queryClient.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (err: unknown) => setEditError(errorMessage(err, "Could not update that role.")),
  });

  const removeStaff = useMutation({
    mutationFn: async (id: string) => api.delete(`/staff/${id}/`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff"] }),
  });

  return (
    <PermissionGate allowed={canManageStaff}>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Staff</h1>
              {!isLoading && staff && staff.length > 0 && (
                <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-500">
                  {staff.length}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-neutral-500">Invite staff to this store and manage who has access.</p>
          </div>

          <button
            onClick={() => {
              setInviteError(null);
              setShowInvite(true);
            }}
            disabled={!roles || roles.length === 0}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-[#E5484D] px-4 text-sm font-medium text-white shadow-sm shadow-[#E5484D]/20 transition-all hover:-translate-y-px hover:bg-[#D6393E] hover:shadow-md hover:shadow-[#E5484D]/30 disabled:cursor-not-allowed disabled:opacity-50"
            title={!roles || roles.length === 0 ? "Create a role first" : undefined}
          >
            <PlusIcon className="h-4 w-4" /> Invite staff
          </button>
        </div>

        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[68px] animate-pulse rounded-2xl bg-neutral-100" />
            ))}
          </div>
        )}

        {!isLoading && staff && staff.length > 0 && (
          <div className="space-y-3">
            {staff.map((s) => (
              <StaffCard
                key={s.id}
                staffMember={s}
                onEdit={() => {
                  setEditError(null);
                  setEditingStaff(s);
                }}
                onToggleActive={() => toggleActive.mutate(s)}
                toggling={toggleActive.isPending && toggleActive.variables?.id === s.id}
                onRemove={() => removeStaff.mutate(s.id)}
                removing={removeStaff.isPending && removeStaff.variables === s.id}
              />
            ))}
          </div>
        )}

        {!isLoading && staff?.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/50 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-neutral-300 shadow-sm">
              <UsersIcon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-medium text-neutral-700">No staff yet</p>
              <p className="mt-0.5 text-xs text-neutral-400">Invite your first team member to this store.</p>
            </div>
            <button
              onClick={() => {
                setInviteError(null);
                setShowInvite(true);
              }}
              disabled={!roles || roles.length === 0}
              className="mt-1 flex items-center gap-1.5 rounded-xl bg-[#E5484D] px-4 py-2 text-sm font-medium text-white hover:bg-[#D6393E] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <PlusIcon className="h-4 w-4" /> Invite staff
            </button>
          </div>
        )}

        {showInvite && (
          <InviteStaffModal
            roles={roles ?? []}
            onClose={() => setShowInvite(false)}
            onSubmit={(values) => invite.mutate(values)}
            submitting={invite.isPending}
            error={inviteError}
          />
        )}

        {editingStaff && (
          <EditStaffModal
            staffMember={editingStaff}
            roles={roles ?? []}
            onClose={() => setEditingStaff(null)}
            onSubmit={(roleId) => updateRole.mutate({ s: editingStaff, roleId })}
            submitting={updateRole.isPending}
            error={editError}
          />
        )}
      </div>
    </PermissionGate>
  );
}
