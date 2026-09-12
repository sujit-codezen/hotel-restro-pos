"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { EditIcon, UsersIcon } from "@/components/ui/icons";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { Paginated } from "@/lib/hooks";
import { OrderT, PosTable } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<
  PosTable["status"],
  { label: string; dot: string; tile: string }
> = {
  AVAILABLE: { label: "Available", dot: "bg-emerald-500", tile: "border-neutral-200 bg-white" },
  OCCUPIED: { label: "Occupied", dot: "bg-[#E5484D]", tile: "border-[#F5C6C7] bg-[#FDECEC]" },
  BILLING: { label: "Billing", dot: "bg-amber-500", tile: "border-amber-200 bg-amber-50" },
  RESERVED: { label: "Reserved", dot: "bg-sky-500", tile: "border-sky-200 bg-sky-50" },
};

// Statuses where a table's order is still being built/served and should
// reopen on the order (cart) screen.
const CART_STAGE_STATUSES = new Set(["OPEN", "HELD", "SENT_TO_KITCHEN", "READY", "SERVED"]);
// BILLED means an Invoice exists but may not be paid/finalized yet — reopen
// straight on checkout, not the cart, and not "start a new order" (Order.bill()
// is not idempotent: calling it twice on the same order fails, since Invoice.order
// is a OneToOneField). Without this, an order billed but abandoned before
// finalize would leave its table stuck OCCUPIED with no way back in.
const BILLED_STATUS = "BILLED";

type TableOrderInfo = { orderId: string; stage: "cart" | "checkout" };
type TableFormValues = { name: string; capacity: number; shape: "square" | "round" };

/** A table's shape in the middle with `capacity` chairs distributed
 * evenly around it — used both in the add/edit popup (as a live preview
 * while picking capacity/shape) and on each tile in the floor grid (so
 * "4 seats" is a glance-able picture, not just text), where `chairColor`
 * follows the same status-dot color as the rest of the tile. */
function TablePreview({
  shape,
  capacity,
  size = 140,
  chairColor = "bg-[#E5484D]",
  showLabel = true,
}: {
  shape: string;
  capacity: number;
  size?: number;
  chairColor?: string;
  showLabel?: boolean;
}) {
  const center = size / 2;
  const inset = size * 0.21;
  const radius = size * 0.37;
  const chairSize = Math.max(8, Math.round(size * 0.11));
  const chairs = Math.max(1, Math.min(capacity, 12));

  return (
    <div className="relative mx-auto" style={{ height: size, width: size }}>
      <div
        className={cn(
          "absolute flex items-center justify-center border-2 border-neutral-300 bg-neutral-50 font-medium text-neutral-400",
          shape === "round" ? "rounded-full" : "rounded-xl",
          size < 100 ? "text-[10px]" : "text-xs"
        )}
        style={{ inset }}
      >
        {showLabel && `${capacity} seats`}
      </div>
      {Array.from({ length: chairs }).map((_, i) => {
        const angle = (360 / chairs) * i - 90;
        const rad = (angle * Math.PI) / 180;
        const x = center + radius * Math.cos(rad);
        const y = center + radius * Math.sin(rad);
        return (
          <div
            key={i}
            className={cn("absolute rounded-full border-2 border-white shadow", chairColor)}
            style={{ left: x - chairSize / 2, top: y - chairSize / 2, height: chairSize, width: chairSize }}
          />
        );
      })}
    </div>
  );
}

/** Shared popup for both creating and editing a table — name, capacity,
 * shape, and the live chair preview are identical either way; only the
 * title, submit label, and whether a delete affordance shows differ. */
function TableFormModal({
  title,
  initial,
  onClose,
  onSubmit,
  submitting,
  submitLabel,
  error,
  onDelete,
  deleting,
  deleteError,
}: {
  title: string;
  initial: TableFormValues;
  onClose: () => void;
  onSubmit: (values: TableFormValues) => void;
  submitting: boolean;
  submitLabel: string;
  error: string | null;
  onDelete?: () => void;
  deleting?: boolean;
  deleteError?: string | null;
}) {
  const [name, setName] = useState(initial.name);
  const [capacity, setCapacity] = useState(initial.capacity);
  const [shape, setShape] = useState(initial.shape);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-100 p-4">
          <p className="font-semibold text-neutral-900">{title}</p>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-4 p-4">
          <TablePreview shape={shape} capacity={capacity} />

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">Table name</label>
            <input
              autoFocus
              placeholder="e.g. T05"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
            />
            <p className="mt-1 text-xs text-neutral-400">
              Must be unique for this store — the slug is generated from it automatically.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">Capacity</label>
            <div className="flex items-center gap-3 rounded-xl border border-neutral-200 px-3 py-1.5">
              <button
                type="button"
                onClick={() => setCapacity((c) => Math.max(1, c - 1))}
                className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
              >
                −
              </button>
              <span className="w-6 text-center text-sm font-medium">{capacity}</span>
              <button
                type="button"
                onClick={() => setCapacity((c) => Math.min(20, c + 1))}
                className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
              >
                +
              </button>
              <span className="text-xs text-neutral-400">seats</span>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">Shape</label>
            <div className="flex gap-2">
              {(["square", "round"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setShape(s)}
                  className={cn(
                    "flex-1 rounded-xl border py-2 text-sm font-medium capitalize transition-colors",
                    shape === s
                      ? "border-[#E5484D] bg-[#FDECEC] text-[#E5484D]"
                      : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {onDelete && (
            <div className="border-t border-neutral-100 pt-4">
              {!confirmingDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="text-sm font-medium text-red-600 hover:underline"
                >
                  Delete table
                </button>
              ) : (
                <div className="space-y-2 rounded-xl bg-red-50 p-3">
                  <p className="text-sm text-red-700">
                    Delete this table? This can&apos;t be undone.
                  </p>
                  {deleteError && <p className="text-xs text-red-600">{deleteError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(false)}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={onDelete}
                      disabled={deleting}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
                    >
                      {deleting ? "Deleting…" : "Yes, delete"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-neutral-100 p-4">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-neutral-500 hover:bg-neutral-100"
          >
            Cancel
          </button>
          <button
            onClick={() => name.trim() && onSubmit({ name, capacity, shape })}
            disabled={!name.trim() || submitting}
            className="flex-1 rounded-xl bg-[#E5484D] py-2.5 text-sm font-medium text-white hover:bg-[#D6393E] disabled:opacity-60"
          >
            {submitting ? `${submitLabel}…` : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PosTablesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const storeId = useAuthStore((s) => s.activeStoreId);
  const [showAddTable, setShowAddTable] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editingTable, setEditingTable] = useState<PosTable | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [mergeFrom, setMergeFrom] = useState("");
  const [mergeInto, setMergeInto] = useState("");

  const { data: tables, isLoading } = useQuery<PosTable[]>({
    queryKey: ["tables", storeId],
    queryFn: async () =>
      (await api.get<Paginated<PosTable>>("/tables/", { params: { store: storeId } })).data
        .results,
    enabled: !!storeId,
  });

  // Orders are ordered newest-first (see Order.Meta.ordering), so the first
  // matching order per table is the one currently occupying it.
  const { data: openOrderByTable } = useQuery<Record<string, TableOrderInfo>>({
    queryKey: ["open-orders-by-table", storeId],
    queryFn: async () => {
      const { data } = await api.get<Paginated<OrderT>>("/orders/", {
        params: { store: storeId },
      });
      const map: Record<string, TableOrderInfo> = {};
      for (const order of data.results) {
        if (!order.table || map[order.table]) continue;
        if (CART_STAGE_STATUSES.has(order.status)) {
          map[order.table] = { orderId: order.id, stage: "cart" };
        } else if (order.status === BILLED_STATUS) {
          map[order.table] = { orderId: order.id, stage: "checkout" };
        }
      }
      return map;
    },
    enabled: !!storeId,
  });

  function errorMessage(err: unknown, fallback: string) {
    const data = (err as { response?: { data?: unknown } })?.response?.data;
    // A ValidationError raised as a plain string outside a serializer
    // (e.g. TableViewSet.perform_destroy's occupied-table guard) comes
    // back as a bare top-level array, not {detail: ...} or {field: [...]}.
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

  const createTable = useMutation({
    mutationFn: async (values: TableFormValues) =>
      api.post("/tables/", { store: storeId, ...values }),
    onSuccess: () => {
      setShowAddTable(false);
      setAddError(null);
      queryClient.invalidateQueries({ queryKey: ["tables", storeId] });
    },
    onError: (err: unknown) =>
      setAddError(errorMessage(err, "Could not create the table — check the name and try again.")),
  });

  const updateTable = useMutation({
    mutationFn: async (values: TableFormValues) =>
      api.patch(`/tables/${editingTable!.id}/`, values),
    onSuccess: () => {
      setEditingTable(null);
      setEditError(null);
      queryClient.invalidateQueries({ queryKey: ["tables", storeId] });
    },
    onError: (err: unknown) =>
      setEditError(errorMessage(err, "Could not save changes — check the name and try again.")),
  });

  const deleteTable = useMutation({
    mutationFn: async () => api.delete(`/tables/${editingTable!.id}/`),
    onSuccess: () => {
      setEditingTable(null);
      setDeleteError(null);
      queryClient.invalidateQueries({ queryKey: ["tables", storeId] });
    },
    onError: (err: unknown) => setDeleteError(errorMessage(err, "Could not delete this table.")),
  });

  const startOrder = useMutation({
    mutationFn: async (table: PosTable) => {
      await api.patch(`/tables/${table.id}/status/`, { status: "OCCUPIED" });
      const { data } = await api.post<OrderT>("/orders/", {
        store: storeId,
        order_type: "DINE_IN",
        table: table.id,
      });
      return data;
    },
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: ["tables", storeId] });
      queryClient.invalidateQueries({ queryKey: ["open-orders-by-table", storeId] });
      router.push(`/pos/order/${order.id}`);
    },
  });

  const mergeTables = useMutation({
    mutationFn: async () => {
      const fromInfo = openOrderByTable?.[mergeFrom];
      const intoInfo = openOrderByTable?.[mergeInto];
      if (!fromInfo || !intoInfo) throw new Error("Both tables need an open order to merge.");
      return api.post(`/orders/${intoInfo.orderId}/merge/`, { other_order_id: fromInfo.orderId });
    },
    onSuccess: () => {
      setMergeFrom("");
      setMergeInto("");
      queryClient.invalidateQueries({ queryKey: ["tables", storeId] });
      queryClient.invalidateQueries({ queryKey: ["open-orders-by-table", storeId] });
    },
  });

  // A table only has a resumable order while it's OCCUPIED. Once finalize()
  // releases it back to AVAILABLE, the openOrderByTable map can still name
  // that same (now fully paid) order for a moment until it's refetched —
  // gating on table.status keeps a finished table offering "Start order",
  // not "Resume checkout" on an invoice that's already settled.
  function orderInfoFor(table: PosTable) {
    return table.status === "OCCUPIED" ? openOrderByTable?.[table.id] : undefined;
  }

  function handleTableClick(table: PosTable) {
    const info = orderInfoFor(table);
    if (info?.stage === "checkout") {
      router.push(`/pos/checkout/${info.orderId}`);
    } else if (info) {
      router.push(`/pos/order/${info.orderId}`);
    } else {
      startOrder.mutate(table);
    }
  }

  function openEditModal(table: PosTable) {
    setEditingTable(table);
    setEditError(null);
    setDeleteError(null);
  }

  // Only tables still mid-order (not yet billed) can be merged — merging
  // into/out of a billed order would leave its invoice lines orphaned from
  // whichever table absorbed the rest of the check.
  const mergeableTables = (tables ?? []).filter((t) => orderInfoFor(t)?.stage === "cart");

  const counts = (tables ?? []).reduce(
    (acc, t) => ({ ...acc, [t.status]: (acc[t.status] ?? 0) + 1 }),
    {} as Partial<Record<PosTable["status"], number>>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Tables</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            {(Object.keys(STATUS_STYLE) as PosTable["status"][]).map((status) => (
              <span key={status} className="flex items-center gap-1.5 text-xs text-neutral-500">
                <span className={cn("h-2 w-2 rounded-full", STATUS_STYLE[status].dot)} />
                {STATUS_STYLE[status].label}
                <span className="text-neutral-400">({counts[status] ?? 0})</span>
              </span>
            ))}
          </div>
        </div>

        <button
          onClick={() => {
            setAddError(null);
            setShowAddTable(true);
          }}
          className="h-10 shrink-0 rounded-xl bg-[#E5484D] px-4 text-sm font-medium text-white hover:bg-[#D6393E]"
        >
          + Add table
        </button>
      </div>

      {showAddTable && (
        <TableFormModal
          title="Add a table"
          initial={{ name: "", capacity: 4, shape: "square" }}
          onClose={() => setShowAddTable(false)}
          onSubmit={(values) => createTable.mutate(values)}
          submitting={createTable.isPending}
          submitLabel="Create table"
          error={addError}
        />
      )}

      {editingTable && (
        <TableFormModal
          title={`Edit ${editingTable.name}`}
          initial={{
            name: editingTable.name,
            capacity: editingTable.capacity,
            shape: editingTable.shape === "round" ? "round" : "square",
          }}
          onClose={() => setEditingTable(null)}
          onSubmit={(values) => updateTable.mutate(values)}
          submitting={updateTable.isPending}
          submitLabel="Save changes"
          error={editError}
          onDelete={() => deleteTable.mutate()}
          deleting={deleteTable.isPending}
          deleteError={deleteError}
        />
      )}

      {isLoading && <p className="text-sm text-neutral-500">Loading tables…</p>}

      {mergeableTables.length >= 2 && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm font-medium text-neutral-900">Merge tables</p>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-400">
                  From (this table&apos;s order moves and it frees up)
                </label>
                <select
                  value={mergeFrom}
                  onChange={(e) => setMergeFrom(e.target.value)}
                  className="h-9 w-40 rounded-lg border border-neutral-200 bg-neutral-50 px-2 text-sm"
                >
                  <option value="">Select table…</option>
                  {mergeableTables
                    .filter((t) => t.id !== mergeInto)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-400">Into</label>
                <select
                  value={mergeInto}
                  onChange={(e) => setMergeInto(e.target.value)}
                  className="h-9 w-40 rounded-lg border border-neutral-200 bg-neutral-50 px-2 text-sm"
                >
                  <option value="">Select table…</option>
                  {mergeableTables
                    .filter((t) => t.id !== mergeFrom)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </div>
              <button
                disabled={!mergeFrom || !mergeInto || mergeTables.isPending}
                onClick={() => mergeTables.mutate()}
                className="h-9 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                Merge
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {tables?.map((table) => {
          const info = orderInfoFor(table);
          const style = STATUS_STYLE[table.status];
          const actionLabel =
            info?.stage === "checkout"
              ? "Resume checkout"
              : info
                ? "Open order"
                : table.status === "OCCUPIED"
                  ? "In use"
                  : "Start order";
          const actionable = !(table.status === "OCCUPIED" && !info);

          return (
            <div
              key={table.id}
              className={cn(
                "relative flex flex-col items-center gap-1 rounded-2xl border p-3 text-center shadow-sm transition-shadow hover:shadow-md",
                style.tile
              )}
            >
              <button
                onClick={() => openEditModal(table)}
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-neutral-400 shadow-sm hover:bg-white hover:text-neutral-600"
                aria-label={`Edit ${table.name}`}
              >
                <EditIcon className="h-3.5 w-3.5" />
              </button>

              <TablePreview
                shape={table.shape}
                capacity={table.capacity}
                size={96}
                chairColor={style.dot}
                showLabel={false}
              />
              <p className="text-lg font-semibold text-neutral-900">{table.name}</p>
              <p className="flex items-center gap-1 text-xs text-neutral-500">
                <UsersIcon className="h-3.5 w-3.5" />
                {table.capacity} seats
              </p>
              <button
                onClick={() => handleTableClick(table)}
                disabled={startOrder.isPending || !actionable}
                className={cn(
                  "mt-1 w-full rounded-lg py-1.5 text-xs font-medium disabled:cursor-default",
                  actionable
                    ? info
                      ? "bg-neutral-900 text-white"
                      : "bg-[#E5484D] text-white"
                    : "bg-neutral-200 text-neutral-500"
                )}
              >
                {actionLabel}
              </button>
            </div>
          );
        })}
      </div>

      {tables?.length === 0 && !isLoading && (
        <p className="text-sm text-neutral-500">No tables yet — add one above.</p>
      )}
    </div>
  );
}
