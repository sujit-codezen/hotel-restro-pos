"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { PermissionGate } from "@/components/permission-gate";
import { EditIcon, ListIcon, PlusIcon, TagIcon, TrashIcon, UtensilsIcon, XIcon } from "@/components/ui/icons";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { Paginated, useHasPermission } from "@/lib/hooks";
import { MenuCategory, MenuItem, Modifier, ModifierGroup, TaxClass } from "@/lib/types";
import { cn, formatCurrency, nameToGradient } from "@/lib/utils";

type Tab = "items" | "categories" | "groups";

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

function ModalShell({
  title,
  icon,
  wide,
  onClose,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  wide?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className={cn(
          "w-full animate-[fadeIn_0.15s_ease-out] rounded-2xl bg-white shadow-2xl ring-1 ring-black/5",
          wide ? "max-w-lg" : "max-w-sm"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-neutral-100 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FDECEC] text-[#E5484D]">
            {icon}
          </span>
          <p className="flex-1 font-semibold text-neutral-900">{title}</p>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
            aria-label="Close"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs font-medium text-neutral-400">{children}</label>;
}

const inputClass =
  "h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]";

function DeleteSection({
  label,
  note,
  onDelete,
  deleting,
  deleteError,
}: {
  label: string;
  note?: string;
  onDelete: () => void;
  deleting?: boolean;
  deleteError?: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="border-t border-neutral-100 pt-4">
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-sm font-medium text-red-600 hover:underline"
        >
          {label}
        </button>
      ) : (
        <div className="space-y-2 rounded-xl bg-red-50 p-3">
          <p className="text-sm text-red-700">{note ?? "This can't be undone."}</p>
          {deleteError && <p className="text-xs text-red-600">{deleteError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
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
  );
}

/* ---------- Categories ---------- */

type CategoryFormValues = { name: string; sort_order: number };

function CategoryFormModal({
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
  initial: CategoryFormValues;
  onClose: () => void;
  onSubmit: (values: CategoryFormValues) => void;
  submitting: boolean;
  submitLabel: string;
  error: string | null;
  onDelete?: () => void;
  deleting?: boolean;
  deleteError?: string | null;
}) {
  const [name, setName] = useState(initial.name);
  const [sortOrder, setSortOrder] = useState(initial.sort_order);
  const valid = name.trim();

  return (
    <ModalShell title={title} icon={<ListIcon className="h-5 w-5" />} onClose={onClose}>
      <div className="space-y-4 p-4">
        <div>
          <FieldLabel>Category name</FieldLabel>
          <input
            autoFocus
            placeholder="e.g. Starters"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <FieldLabel>Sort order</FieldLabel>
          <div className="flex items-center gap-3 rounded-xl border border-neutral-200 px-3 py-1.5">
            <button
              type="button"
              onClick={() => setSortOrder((s) => Math.max(0, s - 1))}
              className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
            >
              −
            </button>
            <span className="w-6 text-center text-sm font-medium">{sortOrder}</span>
            <button
              type="button"
              onClick={() => setSortOrder((s) => s + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
            >
              +
            </button>
            <span className="text-xs text-neutral-400">lower shows first</span>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {onDelete && (
          <DeleteSection
            label="Delete category"
            note="Items in this category will become uncategorized, not deleted."
            onDelete={onDelete}
            deleting={deleting}
            deleteError={deleteError}
          />
        )}
      </div>

      <div className="flex gap-2 border-t border-neutral-100 p-4">
        <button onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-medium text-neutral-500 hover:bg-neutral-100">
          Cancel
        </button>
        <button
          onClick={() => valid && onSubmit({ name, sort_order: sortOrder })}
          disabled={!valid || submitting}
          className="flex-1 rounded-xl bg-[#E5484D] py-2.5 text-sm font-medium text-white hover:bg-[#D6393E] disabled:opacity-60"
        >
          {submitting ? `${submitLabel}…` : submitLabel}
        </button>
      </div>
    </ModalShell>
  );
}

/* ---------- Modifier groups (+ inline modifier management) ---------- */

type GroupFormValues = {
  name: string;
  selection_type: "SINGLE" | "MULTIPLE";
  min_select: number;
  max_select: number;
  is_required: boolean;
};

function ModifierRow({
  modifier,
  storeId,
  onChanged,
}: {
  modifier: Modifier;
  storeId: string | null;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: async () => api.delete(`/modifiers/${modifier.id}/`),
    onSuccess: onChanged,
    onError: (err: unknown) => setError(errorMessage(err, "Could not delete this modifier.")),
  });

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-sm">
      <span className="text-neutral-700">{modifier.name}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-neutral-500">
          {Number(modifier.price_delta) === 0 ? "included" : `+${formatCurrency(modifier.price_delta)}`}
        </span>
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="flex h-6 w-6 items-center justify-center rounded-full text-neutral-300 hover:bg-white hover:text-red-500"
            aria-label={`Delete ${modifier.name}`}
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-white"
            >
              Keep
            </button>
            <button
              type="button"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="rounded-md bg-red-600 px-1.5 py-0.5 text-xs text-white hover:bg-red-700 disabled:opacity-60"
            >
              {remove.isPending ? "…" : "Delete"}
            </button>
          </div>
        )}
      </div>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </div>
  );
}

function ManageModifiers({ group, storeId }: { group: ModifierGroup; storeId: string | null }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [priceDelta, setPriceDelta] = useState("0");
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["modifier-groups", storeId] });
  }

  const add = useMutation({
    mutationFn: async () =>
      api.post("/modifiers/", { modifier_group: group.id, name, price_delta: priceDelta || "0" }),
    onSuccess: () => {
      setName("");
      setPriceDelta("0");
      setError(null);
      refresh();
    },
    onError: (err: unknown) => setError(errorMessage(err, "Could not add that modifier.")),
  });

  return (
    <div className="space-y-2 border-t border-neutral-100 pt-4">
      <p className="text-xs font-medium text-neutral-400">Modifiers in this group</p>

      {group.modifiers.length > 0 ? (
        <div className="space-y-1.5">
          {group.modifiers.map((m) => (
            <ModifierRow key={m.id} modifier={m} storeId={storeId} onChanged={refresh} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-neutral-400">No modifiers yet — add one below.</p>
      )}

      <div className="flex gap-2 pt-1">
        <input
          placeholder="e.g. Extra cheese"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9 flex-1 rounded-lg border border-neutral-200 bg-white px-2.5 text-sm outline-none focus:border-[#E5484D]"
        />
        <input
          type="number"
          step="0.01"
          placeholder="+price"
          value={priceDelta}
          onChange={(e) => setPriceDelta(e.target.value)}
          className="h-9 w-24 rounded-lg border border-neutral-200 bg-white px-2.5 text-sm outline-none focus:border-[#E5484D]"
        />
        <button
          type="button"
          onClick={() => name.trim() && add.mutate()}
          disabled={!name.trim() || add.isPending}
          className="flex h-9 items-center gap-1 rounded-lg bg-neutral-900 px-3 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          <PlusIcon className="h-3.5 w-3.5" /> Add
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function GroupFormModal({
  title,
  initial,
  editingGroup,
  storeId,
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
  initial: GroupFormValues;
  editingGroup: ModifierGroup | null;
  storeId: string | null;
  onClose: () => void;
  onSubmit: (values: GroupFormValues) => void;
  submitting: boolean;
  submitLabel: string;
  error: string | null;
  onDelete?: () => void;
  deleting?: boolean;
  deleteError?: string | null;
}) {
  const [name, setName] = useState(initial.name);
  const [selectionType, setSelectionType] = useState(initial.selection_type);
  const [minSelect, setMinSelect] = useState(initial.min_select);
  const [maxSelect, setMaxSelect] = useState(initial.max_select);
  const [isRequired, setIsRequired] = useState(initial.is_required);
  const valid = name.trim();

  return (
    <ModalShell title={title} icon={<TagIcon className="h-5 w-5" />} wide onClose={onClose}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
        <div>
          <FieldLabel>Group name</FieldLabel>
          <input
            autoFocus
            placeholder="e.g. Toppings"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <FieldLabel>Selection type</FieldLabel>
          <div className="flex gap-2">
            {(["SINGLE", "MULTIPLE"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSelectionType(t)}
                className={cn(
                  "flex-1 rounded-xl border py-2 text-sm font-medium transition-colors",
                  selectionType === t
                    ? "border-[#E5484D] bg-[#FDECEC] text-[#E5484D]"
                    : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                )}
              >
                {t === "SINGLE" ? "Single choice" : "Multiple choice"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>Min select</FieldLabel>
            <div className="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-1.5">
              <button type="button" onClick={() => setMinSelect((v) => Math.max(0, v - 1))} className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100">−</button>
              <span className="w-5 flex-1 text-center text-sm font-medium">{minSelect}</span>
              <button type="button" onClick={() => setMinSelect((v) => v + 1)} className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100">+</button>
            </div>
          </div>
          <div>
            <FieldLabel>Max select</FieldLabel>
            <div className="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-1.5">
              <button type="button" onClick={() => setMaxSelect((v) => Math.max(1, v - 1))} className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100">−</button>
              <span className="w-5 flex-1 text-center text-sm font-medium">{maxSelect}</span>
              <button type="button" onClick={() => setMaxSelect((v) => v + 1)} className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100">+</button>
            </div>
          </div>
        </div>

        <div>
          <FieldLabel>Required?</FieldLabel>
          <div className="flex gap-2">
            {[
              { v: true, label: "Required" },
              { v: false, label: "Optional" },
            ].map((opt) => (
              <button
                key={String(opt.v)}
                type="button"
                onClick={() => setIsRequired(opt.v)}
                className={cn(
                  "flex-1 rounded-xl border py-2 text-sm font-medium transition-colors",
                  isRequired === opt.v
                    ? "border-[#E5484D] bg-[#FDECEC] text-[#E5484D]"
                    : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {editingGroup ? (
          <ManageModifiers group={editingGroup} storeId={storeId} />
        ) : (
          <p className="rounded-xl bg-neutral-50 p-3 text-xs text-neutral-400">
            Save the group first, then reopen it to add individual modifiers.
          </p>
        )}

        {onDelete && (
          <DeleteSection
            label="Delete group"
            note="This also removes its modifiers, unless any have order history."
            onDelete={onDelete}
            deleting={deleting}
            deleteError={deleteError}
          />
        )}
      </div>

      <div className="flex gap-2 border-t border-neutral-100 p-4">
        <button onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-medium text-neutral-500 hover:bg-neutral-100">
          Cancel
        </button>
        <button
          onClick={() =>
            valid &&
            onSubmit({ name, selection_type: selectionType, min_select: minSelect, max_select: maxSelect, is_required: isRequired })
          }
          disabled={!valid || submitting}
          className="flex-1 rounded-xl bg-[#E5484D] py-2.5 text-sm font-medium text-white hover:bg-[#D6393E] disabled:opacity-60"
        >
          {submitting ? `${submitLabel}…` : submitLabel}
        </button>
      </div>
    </ModalShell>
  );
}

/* ---------- Menu items ---------- */

/** Attaches/detaches reusable ModifierGroups (e.g. "Size", "Toppings") on
 * one specific item — this is the actual "how do toppings/variations get
 * added to a dish" step; building a group in the Modifier Groups tab only
 * puts it in the library, it does nothing on its own until it's attached
 * here to the items that should offer it. */
/** One option row within an attached group, on the item edit modal — the
 * checkbox is whether this item offers that option at all (an item-level
 * MenuItemModifier row exists), and the price is specific to this item:
 * the same "Large" can cost something different on a pizza than on a
 * momo, since price now lives on the (item, modifier) pair, not on the
 * modifier/group definition itself. */
function ItemModifierRow({
  itemId,
  modifier,
  override,
  storeId,
}: {
  itemId: string;
  modifier: Modifier;
  override: Modifier | undefined;
  storeId: string | null;
}) {
  const queryClient = useQueryClient();
  const checked = !!override;
  const [price, setPrice] = useState(override?.price_delta ?? modifier.price_delta);

  useEffect(() => {
    setPrice(override?.price_delta ?? modifier.price_delta);
  }, [override?.price_delta, modifier.price_delta]);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["menu-items", storeId, "all"] });
  }

  const setOverride = useMutation({
    mutationFn: async (priceDelta: string) =>
      api.post(`/menu-items/${itemId}/item-modifiers/`, { modifier: modifier.id, price_delta: priceDelta }),
    onSuccess: refresh,
  });
  const removeOverride = useMutation({
    mutationFn: async () => api.delete(`/menu-items/${itemId}/item-modifiers/${modifier.id}/`),
    onSuccess: refresh,
  });

  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 text-sm hover:bg-neutral-50">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => (e.target.checked ? setOverride.mutate(price) : removeOverride.mutate())}
        className="h-4 w-4 shrink-0 rounded border-neutral-300 text-[#E5484D] focus:ring-[#E5484D]"
      />
      <span className={cn("flex-1 truncate", checked ? "text-neutral-700" : "text-neutral-400")}>
        {modifier.name}
      </span>
      <div className="flex items-center gap-1">
        <span className="text-xs text-neutral-400">+Rs</span>
        <input
          type="number"
          step="0.01"
          value={price}
          disabled={!checked}
          onChange={(e) => setPrice(e.target.value)}
          onBlur={() => checked && price !== override?.price_delta && setOverride.mutate(price)}
          className="h-7 w-20 rounded-md border border-neutral-200 px-1.5 text-xs outline-none focus:border-[#E5484D] disabled:bg-neutral-50 disabled:text-neutral-300"
        />
      </div>
    </div>
  );
}

function ManageItemGroups({ item, allGroups, storeId }: { item: MenuItem; allGroups: ModifierGroup[]; storeId: string | null }) {
  const queryClient = useQueryClient();
  const [pickedGroup, setPickedGroup] = useState("");
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["menu-items", storeId, "all"] });
  }

  const attach = useMutation({
    mutationFn: async () => api.post(`/menu-items/${item.id}/modifier-groups/`, { modifier_group: pickedGroup }),
    onSuccess: () => {
      setPickedGroup("");
      setError(null);
      refresh();
    },
    onError: (err: unknown) => setError(errorMessage(err, "Could not attach that group.")),
  });

  const detach = useMutation({
    mutationFn: async (groupId: string) => api.delete(`/menu-items/${item.id}/modifier-groups/${groupId}/`),
    onSuccess: refresh,
  });

  const attachedIds = new Set(item.modifier_groups.map((g) => g.id));
  const availableToAttach = allGroups.filter((g) => !attachedIds.has(g.id));

  return (
    <div className="space-y-2 border-t border-neutral-100 pt-4">
      <p className="text-xs font-medium text-neutral-400">Toppings &amp; variations (modifier groups) on this item</p>

      {item.modifier_groups.length > 0 ? (
        <div className="space-y-2">
          {item.modifier_groups.map((attachedGroup) => {
            const fullGroup = allGroups.find((g) => g.id === attachedGroup.id);
            const options = fullGroup?.modifiers ?? attachedGroup.modifiers;
            return (
              <div key={attachedGroup.id} className="overflow-hidden rounded-xl border border-neutral-200">
                <div className="flex items-center justify-between border-b border-neutral-100 bg-neutral-50 px-3 py-1.5">
                  <div>
                    <span className="text-sm font-medium text-neutral-800">{attachedGroup.name}</span>
                    <span className="ml-1.5 text-xs text-neutral-400">
                      {attachedGroup.selection_type === "SINGLE" ? "Single" : "Multiple"} choice
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => detach.mutate(attachedGroup.id)}
                    disabled={detach.isPending}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-neutral-300 hover:bg-white hover:text-red-500 disabled:opacity-50"
                    aria-label={`Remove ${attachedGroup.name}`}
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
                {options.length > 0 ? (
                  <div className="divide-y divide-neutral-50">
                    {options.map((m) => (
                      <ItemModifierRow
                        key={m.id}
                        itemId={item.id}
                        modifier={m}
                        override={attachedGroup.modifiers.find((am) => am.id === m.id)}
                        storeId={storeId}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="px-3 py-2 text-xs text-neutral-400">
                    This group has no options yet — add some from the Modifier Groups tab.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-neutral-400">No toppings or variations attached yet.</p>
      )}

      {availableToAttach.length > 0 ? (
        <div className="flex gap-2 pt-1">
          <select
            value={pickedGroup}
            onChange={(e) => setPickedGroup(e.target.value)}
            className="h-9 flex-1 rounded-lg border border-neutral-200 bg-white px-2.5 text-sm outline-none focus:border-[#E5484D]"
          >
            <option value="">Select a group…</option>
            {availableToAttach.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => pickedGroup && attach.mutate()}
            disabled={!pickedGroup || attach.isPending}
            className="flex h-9 items-center gap-1 rounded-lg bg-neutral-900 px-3 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            <PlusIcon className="h-3.5 w-3.5" /> Attach
          </button>
        </div>
      ) : (
        allGroups.length === 0 && (
          <p className="text-xs text-neutral-400">
            No modifier groups exist yet — build one from the Modifier Groups tab first.
          </p>
        )
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

type ItemFormValues = {
  name: string;
  price: string;
  category: string;
  tax_class: string;
  kitchen_station: string;
  is_active: boolean;
  image: File | null;
};

function ItemFormModal({
  title,
  initial,
  categories,
  taxClasses,
  editingItem,
  allGroups,
  storeId,
  onClose,
  onSubmit,
  submitting,
  submitLabel,
  error,
  onDelete,
  deleting,
  deleteError,
  currentImageUrl,
}: {
  title: string;
  initial: ItemFormValues;
  categories: MenuCategory[];
  taxClasses: TaxClass[];
  editingItem: MenuItem | null;
  allGroups: ModifierGroup[];
  storeId: string | null;
  onClose: () => void;
  onSubmit: (values: ItemFormValues) => void;
  submitting: boolean;
  submitLabel: string;
  error: string | null;
  onDelete?: () => void;
  deleting?: boolean;
  deleteError?: string | null;
  currentImageUrl?: string | null;
}) {
  const [name, setName] = useState(initial.name);
  const [price, setPrice] = useState(initial.price);
  const [category, setCategory] = useState(initial.category);
  const [taxClass, setTaxClass] = useState(initial.tax_class);
  const [kitchenStation, setKitchenStation] = useState(initial.kitchen_station);
  const [isActive, setIsActive] = useState(initial.is_active);
  const [image, setImage] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const valid = name.trim() && price.trim();

  const previewUrl = image ? URL.createObjectURL(image) : currentImageUrl;

  return (
    <ModalShell title={title} icon={<UtensilsIcon className="h-5 w-5" />} wide onClose={onClose}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
        <div className="flex items-center gap-3">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="" className="h-16 w-16 rounded-xl object-cover" />
          ) : (
            <div
              className="flex h-16 w-16 items-center justify-center rounded-xl text-lg font-semibold text-white/90"
              style={{ background: nameToGradient(name || "?") }}
            >
              {(name || "?").charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setImage(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
            >
              {previewUrl ? "Change photo" : "Add photo"}
            </button>
            <p className="mt-1 text-xs text-neutral-400">Optional — a color tile is used otherwise.</p>
          </div>
        </div>

        <div>
          <FieldLabel>Item name</FieldLabel>
          <input
            autoFocus
            placeholder="e.g. Chicken Momo"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>Price</FieldLabel>
            <input
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel>Category</FieldLabel>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>Tax class</FieldLabel>
            <select value={taxClass} onChange={(e) => setTaxClass(e.target.value)} className={inputClass}>
              <option value="">No tax</option>
              {taxClasses.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.rate_percent}%)
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>Kitchen station</FieldLabel>
            <input
              placeholder="Kitchen"
              value={kitchenStation}
              onChange={(e) => setKitchenStation(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <FieldLabel>Availability</FieldLabel>
          <div className="flex gap-2">
            {[
              { v: true, label: "Active" },
              { v: false, label: "Inactive" },
            ].map((opt) => (
              <button
                key={String(opt.v)}
                type="button"
                onClick={() => setIsActive(opt.v)}
                className={cn(
                  "flex-1 rounded-xl border py-2 text-sm font-medium transition-colors",
                  isActive === opt.v
                    ? "border-[#E5484D] bg-[#FDECEC] text-[#E5484D]"
                    : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {editingItem ? (
          <ManageItemGroups item={editingItem} allGroups={allGroups} storeId={storeId} />
        ) : (
          <p className="rounded-xl bg-neutral-50 p-3 text-xs text-neutral-400">
            Save the item first, then reopen it to attach toppings &amp; variations (modifier groups).
          </p>
        )}

        {onDelete && (
          <DeleteSection
            label="Delete item"
            note="Items with order history can't be deleted — deactivate instead."
            onDelete={onDelete}
            deleting={deleting}
            deleteError={deleteError}
          />
        )}
      </div>

      <div className="flex gap-2 border-t border-neutral-100 p-4">
        <button onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-medium text-neutral-500 hover:bg-neutral-100">
          Cancel
        </button>
        <button
          onClick={() =>
            valid &&
            onSubmit({
              name,
              price,
              category,
              tax_class: taxClass,
              kitchen_station: kitchenStation,
              is_active: isActive,
              image,
            })
          }
          disabled={!valid || submitting}
          className="flex-1 rounded-xl bg-[#E5484D] py-2.5 text-sm font-medium text-white hover:bg-[#D6393E] disabled:opacity-60"
        >
          {submitting ? `${submitLabel}…` : submitLabel}
        </button>
      </div>
    </ModalShell>
  );
}

/* ---------- Page ---------- */

export default function AdminMenuPage() {
  const canManageMenu = useHasPermission("can_manage_menu");
  const storeId = useAuthStore((s) => s.activeStoreId);
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>("items");
  const [activeFilter, setActiveFilter] = useState<boolean | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const [showAddItem, setShowAddItem] = useState(false);
  const [addItemError, setAddItemError] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [editItemError, setEditItemError] = useState<string | null>(null);
  const [deleteItemError, setDeleteItemError] = useState<string | null>(null);

  const [showAddCategory, setShowAddCategory] = useState(false);
  const [addCategoryError, setAddCategoryError] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<MenuCategory | null>(null);
  const [editCategoryError, setEditCategoryError] = useState<string | null>(null);
  const [deleteCategoryError, setDeleteCategoryError] = useState<string | null>(null);

  const [showAddGroup, setShowAddGroup] = useState(false);
  const [addGroupError, setAddGroupError] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<ModifierGroup | null>(null);
  const [editGroupError, setEditGroupError] = useState<string | null>(null);
  const [deleteGroupError, setDeleteGroupError] = useState<string | null>(null);

  const categoriesQuery = useQuery<MenuCategory[]>({
    queryKey: ["menu-categories", storeId],
    queryFn: async () =>
      (await api.get<Paginated<MenuCategory>>("/menu-categories/", { params: { store: storeId } })).data.results,
    enabled: !!storeId,
  });

  const itemsQuery = useQuery<MenuItem[]>({
    queryKey: ["menu-items", storeId, "all"],
    queryFn: async () =>
      (await api.get<Paginated<MenuItem>>("/menu-items/", { params: { store: storeId } })).data.results,
    enabled: !!storeId,
  });

  const groupsQuery = useQuery<ModifierGroup[]>({
    queryKey: ["modifier-groups", storeId],
    queryFn: async () =>
      (await api.get<Paginated<ModifierGroup>>("/modifier-groups/", { params: { store: storeId } })).data.results,
    enabled: !!storeId,
  });

  const taxClassesQuery = useQuery<TaxClass[]>({
    queryKey: ["tax-classes"],
    queryFn: async () => (await api.get<Paginated<TaxClass>>("/tax-classes/")).data.results,
  });

  function invalidateItems() {
    queryClient.invalidateQueries({ queryKey: ["menu-items", storeId, "all"] });
  }
  function invalidateCategories() {
    queryClient.invalidateQueries({ queryKey: ["menu-categories", storeId] });
  }
  function invalidateGroups() {
    queryClient.invalidateQueries({ queryKey: ["modifier-groups", storeId] });
  }

  function itemFormData(values: ItemFormValues) {
    const form = new FormData();
    form.append("store", storeId!);
    form.append("name", values.name);
    form.append("price", values.price);
    form.append("category", values.category || "");
    form.append("tax_class", values.tax_class || "");
    form.append("kitchen_station", values.kitchen_station || "Kitchen");
    form.append("is_active", String(values.is_active));
    if (values.image) form.append("image", values.image);
    return form;
  }

  const createItem = useMutation({
    mutationFn: async (values: ItemFormValues) =>
      api.post("/menu-items/", itemFormData(values), { headers: { "Content-Type": "multipart/form-data" } }),
    onSuccess: () => {
      setShowAddItem(false);
      setAddItemError(null);
      invalidateItems();
    },
    onError: (err: unknown) => setAddItemError(errorMessage(err, "Could not create the item.")),
  });

  const updateItem = useMutation({
    mutationFn: async (values: ItemFormValues) =>
      api.patch(`/menu-items/${editingItem!.id}/`, itemFormData(values), {
        headers: { "Content-Type": "multipart/form-data" },
      }),
    onSuccess: () => {
      setEditingItem(null);
      setEditItemError(null);
      invalidateItems();
    },
    onError: (err: unknown) => setEditItemError(errorMessage(err, "Could not save changes.")),
  });

  const deleteItem = useMutation({
    mutationFn: async () => api.delete(`/menu-items/${editingItem!.id}/`),
    onSuccess: () => {
      setEditingItem(null);
      setDeleteItemError(null);
      invalidateItems();
    },
    onError: (err: unknown) => setDeleteItemError(errorMessage(err, "Could not delete this item.")),
  });

  const toggleActive = useMutation({
    mutationFn: async (item: MenuItem) => api.patch(`/menu-items/${item.id}/`, { is_active: !item.is_active }),
    onSuccess: invalidateItems,
  });

  const createCategory = useMutation({
    mutationFn: async (values: CategoryFormValues) => api.post("/menu-categories/", { store: storeId, ...values }),
    onSuccess: () => {
      setShowAddCategory(false);
      setAddCategoryError(null);
      invalidateCategories();
    },
    onError: (err: unknown) => setAddCategoryError(errorMessage(err, "Could not create the category.")),
  });

  const updateCategory = useMutation({
    mutationFn: async (values: CategoryFormValues) => api.patch(`/menu-categories/${editingCategory!.id}/`, values),
    onSuccess: () => {
      setEditingCategory(null);
      setEditCategoryError(null);
      invalidateCategories();
    },
    onError: (err: unknown) => setEditCategoryError(errorMessage(err, "Could not save changes.")),
  });

  const deleteCategory = useMutation({
    mutationFn: async () => api.delete(`/menu-categories/${editingCategory!.id}/`),
    onSuccess: () => {
      setEditingCategory(null);
      setDeleteCategoryError(null);
      invalidateCategories();
      invalidateItems();
    },
    onError: (err: unknown) => setDeleteCategoryError(errorMessage(err, "Could not delete this category.")),
  });

  const createGroup = useMutation({
    mutationFn: async (values: GroupFormValues) => api.post("/modifier-groups/", { store: storeId, ...values }),
    onSuccess: () => {
      setShowAddGroup(false);
      setAddGroupError(null);
      invalidateGroups();
    },
    onError: (err: unknown) => setAddGroupError(errorMessage(err, "Could not create the group.")),
  });

  const updateGroup = useMutation({
    mutationFn: async (values: GroupFormValues) => api.patch(`/modifier-groups/${editingGroup!.id}/`, values),
    onSuccess: (_data, values) => {
      setEditingGroup((g) => (g ? { ...g, ...values } : g));
      setEditGroupError(null);
      invalidateGroups();
    },
    onError: (err: unknown) => setEditGroupError(errorMessage(err, "Could not save changes.")),
  });

  const deleteGroup = useMutation({
    mutationFn: async () => api.delete(`/modifier-groups/${editingGroup!.id}/`),
    onSuccess: () => {
      setEditingGroup(null);
      setDeleteGroupError(null);
      invalidateGroups();
    },
    onError: (err: unknown) => setDeleteGroupError(errorMessage(err, "Could not delete this group.")),
  });

  const items = itemsQuery.data ?? [];
  const activeCount = items.filter((i) => i.is_active).length;
  const inactiveCount = items.length - activeCount;
  const shownItems = items.filter(
    (i) =>
      (activeFilter === null || i.is_active === activeFilter) &&
      (categoryFilter === null || i.category === categoryFilter)
  );
  const categoryName = (id: string | null) => categoriesQuery.data?.find((c) => c.id === id)?.name;
  const itemCountByCategory = items.reduce<Record<string, number>>((acc, i) => {
    if (i.category) acc[i.category] = (acc[i.category] ?? 0) + 1;
    return acc;
  }, {});

  const TABS: { id: Tab; label: string; icon: React.ReactNode; count: number }[] = [
    { id: "items", label: "Items", icon: <UtensilsIcon className="h-4 w-4" />, count: items.length },
    { id: "categories", label: "Categories", icon: <ListIcon className="h-4 w-4" />, count: categoriesQuery.data?.length ?? 0 },
    { id: "groups", label: "Modifier Groups", icon: <TagIcon className="h-4 w-4" />, count: groupsQuery.data?.length ?? 0 },
  ];

  return (
    <PermissionGate allowed={canManageMenu}>
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Menu</h1>
          <p className="mt-0.5 text-sm text-neutral-500">Manage your items, categories, and modifiers.</p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="flex rounded-xl bg-neutral-100 p-1 text-sm font-medium">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition-all",
                  tab === t.id ? "bg-white text-[#E5484D] shadow-sm" : "text-neutral-500 hover:text-neutral-700"
                )}
              >
                {t.icon} {t.label} ({t.count})
              </button>
            ))}
          </div>

          {tab === "items" && (
            <button
              onClick={() => {
                setAddItemError(null);
                setShowAddItem(true);
              }}
              className="flex h-10 items-center gap-1.5 rounded-xl bg-[#E5484D] px-4 text-sm font-medium text-white shadow-sm shadow-[#E5484D]/20 transition-all hover:-translate-y-px hover:bg-[#D6393E] hover:shadow-md hover:shadow-[#E5484D]/30"
            >
              <PlusIcon className="h-4 w-4" /> Item
            </button>
          )}
          {tab === "categories" && (
            <button
              onClick={() => {
                setAddCategoryError(null);
                setShowAddCategory(true);
              }}
              className="flex h-10 items-center gap-1.5 rounded-xl bg-[#E5484D] px-4 text-sm font-medium text-white shadow-sm shadow-[#E5484D]/20 transition-all hover:-translate-y-px hover:bg-[#D6393E] hover:shadow-md hover:shadow-[#E5484D]/30"
            >
              <PlusIcon className="h-4 w-4" /> Category
            </button>
          )}
          {tab === "groups" && (
            <button
              onClick={() => {
                setAddGroupError(null);
                setShowAddGroup(true);
              }}
              className="flex h-10 items-center gap-1.5 rounded-xl bg-[#E5484D] px-4 text-sm font-medium text-white shadow-sm shadow-[#E5484D]/20 transition-all hover:-translate-y-px hover:bg-[#D6393E] hover:shadow-md hover:shadow-[#E5484D]/30"
            >
              <PlusIcon className="h-4 w-4" /> Group
            </button>
          )}
        </div>
      </div>

      {showAddItem && (
        <ItemFormModal
          title="Add a menu item"
          initial={{ name: "", price: "", category: "", tax_class: "", kitchen_station: "Kitchen", is_active: true, image: null }}
          editingItem={null}
          allGroups={groupsQuery.data ?? []}
          storeId={storeId}
          categories={categoriesQuery.data ?? []}
          taxClasses={taxClassesQuery.data ?? []}
          onClose={() => setShowAddItem(false)}
          onSubmit={(values) => createItem.mutate(values)}
          submitting={createItem.isPending}
          submitLabel="Create item"
          error={addItemError}
        />
      )}

      {editingItem && (
        <ItemFormModal
          title={`Edit ${editingItem.name}`}
          initial={{
            name: editingItem.name,
            price: editingItem.price,
            category: editingItem.category ?? "",
            tax_class: editingItem.tax_class ?? "",
            kitchen_station: editingItem.kitchen_station,
            is_active: editingItem.is_active,
            image: null,
          }}
          currentImageUrl={editingItem.image}
          editingItem={itemsQuery.data?.find((i) => i.id === editingItem.id) ?? editingItem}
          allGroups={groupsQuery.data ?? []}
          storeId={storeId}
          categories={categoriesQuery.data ?? []}
          taxClasses={taxClassesQuery.data ?? []}
          onClose={() => setEditingItem(null)}
          onSubmit={(values) => updateItem.mutate(values)}
          submitting={updateItem.isPending}
          submitLabel="Save changes"
          error={editItemError}
          onDelete={() => deleteItem.mutate()}
          deleting={deleteItem.isPending}
          deleteError={deleteItemError}
        />
      )}

      {showAddCategory && (
        <CategoryFormModal
          title="Add a category"
          initial={{ name: "", sort_order: (categoriesQuery.data?.length ?? 0) * 10 }}
          onClose={() => setShowAddCategory(false)}
          onSubmit={(values) => createCategory.mutate(values)}
          submitting={createCategory.isPending}
          submitLabel="Create category"
          error={addCategoryError}
        />
      )}

      {editingCategory && (
        <CategoryFormModal
          title={`Edit ${editingCategory.name}`}
          initial={{ name: editingCategory.name, sort_order: editingCategory.sort_order }}
          onClose={() => setEditingCategory(null)}
          onSubmit={(values) => updateCategory.mutate(values)}
          submitting={updateCategory.isPending}
          submitLabel="Save changes"
          error={editCategoryError}
          onDelete={() => deleteCategory.mutate()}
          deleting={deleteCategory.isPending}
          deleteError={deleteCategoryError}
        />
      )}

      {showAddGroup && (
        <GroupFormModal
          title="Add a modifier group"
          initial={{ name: "", selection_type: "MULTIPLE", min_select: 0, max_select: 5, is_required: false }}
          editingGroup={null}
          storeId={storeId}
          onClose={() => setShowAddGroup(false)}
          onSubmit={(values) => createGroup.mutate(values)}
          submitting={createGroup.isPending}
          submitLabel="Create group"
          error={addGroupError}
        />
      )}

      {editingGroup && (
        <GroupFormModal
          title={`Edit ${editingGroup.name}`}
          initial={{
            name: editingGroup.name,
            selection_type: editingGroup.selection_type,
            min_select: editingGroup.min_select,
            max_select: editingGroup.max_select,
            is_required: editingGroup.is_required,
          }}
          editingGroup={groupsQuery.data?.find((g) => g.id === editingGroup.id) ?? editingGroup}
          storeId={storeId}
          onClose={() => setEditingGroup(null)}
          onSubmit={(values) => updateGroup.mutate(values)}
          submitting={updateGroup.isPending}
          submitLabel="Save changes"
          error={editGroupError}
          onDelete={() => deleteGroup.mutate()}
          deleting={deleteGroup.isPending}
          deleteError={deleteGroupError}
        />
      )}

      {tab === "items" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setActiveFilter(activeFilter === true ? null : true)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                activeFilter === true ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-neutral-200 text-neutral-500 hover:bg-neutral-50"
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active ({activeCount})
            </button>
            <button
              onClick={() => setActiveFilter(activeFilter === false ? null : false)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                activeFilter === false ? "border-neutral-300 bg-neutral-100 text-neutral-700" : "border-neutral-200 text-neutral-500 hover:bg-neutral-50"
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-neutral-400" /> Inactive ({inactiveCount})
            </button>

            {categoriesQuery.data && categoriesQuery.data.length > 0 && (
              <>
                <span className="mx-1 h-4 w-px bg-neutral-200" />
                <button
                  onClick={() => setCategoryFilter(null)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                    categoryFilter === null ? "border-[#E5484D] bg-[#FDECEC] text-[#E5484D]" : "border-neutral-200 text-neutral-500 hover:bg-neutral-50"
                  )}
                >
                  All categories
                </button>
                {categoriesQuery.data.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCategoryFilter(categoryFilter === c.id ? null : c.id)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                      categoryFilter === c.id ? "border-[#E5484D] bg-[#FDECEC] text-[#E5484D]" : "border-neutral-200 text-neutral-500 hover:bg-neutral-50"
                    )}
                  >
                    {c.name}
                  </button>
                ))}
              </>
            )}
          </div>

          {itemsQuery.isLoading && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-44 animate-pulse rounded-2xl bg-neutral-100" />
              ))}
            </div>
          )}

          {!itemsQuery.isLoading && shownItems.length > 0 && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {shownItems.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    "group relative flex flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg",
                    item.is_active ? "border-neutral-200" : "border-neutral-200 opacity-60"
                  )}
                >
                  <button
                    onClick={() => {
                      setEditingItem(item);
                      setEditItemError(null);
                      setDeleteItemError(null);
                    }}
                    className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-neutral-500 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100"
                    aria-label={`Edit ${item.name}`}
                  >
                    <EditIcon className="h-3.5 w-3.5" />
                  </button>

                  {item.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.image} alt={item.name} className="h-24 w-full object-cover" />
                  ) : (
                    <div
                      className="flex h-24 w-full items-center justify-center text-xl font-semibold text-white/90"
                      style={{ background: nameToGradient(item.name) }}
                    >
                      {item.name.charAt(0).toUpperCase()}
                    </div>
                  )}

                  <div className="flex flex-1 flex-col gap-1 p-3">
                    <p className="truncate text-sm font-semibold text-neutral-900">{item.name}</p>
                    {item.category && (
                      <p className="truncate text-xs text-neutral-400">{categoryName(item.category)}</p>
                    )}
                    <p className="mt-auto text-sm font-semibold text-neutral-900">{formatCurrency(item.price)}</p>
                    <button
                      onClick={() => toggleActive.mutate(item)}
                      disabled={toggleActive.isPending}
                      className={cn(
                        "mt-1 flex items-center gap-1.5 self-start rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors",
                        item.is_active ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
                      )}
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full", item.is_active ? "bg-emerald-500" : "bg-neutral-400")} />
                      {item.is_active ? "Active" : "Inactive"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!itemsQuery.isLoading && items.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/50 py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-neutral-300 shadow-sm">
                <UtensilsIcon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-medium text-neutral-700">No menu items yet</p>
                <p className="mt-0.5 text-xs text-neutral-400">Add your first dish to get started.</p>
              </div>
              <button
                onClick={() => {
                  setAddItemError(null);
                  setShowAddItem(true);
                }}
                className="mt-1 flex items-center gap-1.5 rounded-xl bg-[#E5484D] px-4 py-2 text-sm font-medium text-white hover:bg-[#D6393E]"
              >
                <PlusIcon className="h-4 w-4" /> Item
              </button>
            </div>
          )}

          {!itemsQuery.isLoading && items.length > 0 && shownItems.length === 0 && (
            <p className="py-6 text-center text-sm text-neutral-500">No items match this filter.</p>
          )}
        </>
      )}

      {tab === "categories" && (
        <>
          {categoriesQuery.isLoading && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-28 animate-pulse rounded-2xl bg-neutral-100" />
              ))}
            </div>
          )}

          {!categoriesQuery.isLoading && categoriesQuery.data && categoriesQuery.data.length > 0 && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {categoriesQuery.data.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setEditingCategory(c);
                    setEditCategoryError(null);
                    setDeleteCategoryError(null);
                  }}
                  className="group relative flex flex-col items-center gap-1.5 rounded-2xl border border-neutral-200 bg-white p-4 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-neutral-300 opacity-0 transition-opacity group-hover:bg-neutral-50 group-hover:text-neutral-500 group-hover:opacity-100">
                    <EditIcon className="h-3.5 w-3.5" />
                  </span>
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
                    <ListIcon className="h-5 w-5" />
                  </span>
                  <p className="text-sm font-semibold text-neutral-900">{c.name}</p>
                  <span className="rounded-full bg-neutral-50 px-2.5 py-0.5 text-[11px] font-medium text-neutral-500">
                    {itemCountByCategory[c.id] ?? 0} item{itemCountByCategory[c.id] === 1 ? "" : "s"}
                  </span>
                </button>
              ))}
            </div>
          )}

          {!categoriesQuery.isLoading && categoriesQuery.data?.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/50 py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-neutral-300 shadow-sm">
                <ListIcon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-medium text-neutral-700">No categories yet</p>
                <p className="mt-0.5 text-xs text-neutral-400">Group your items so the POS menu is easy to browse.</p>
              </div>
              <button
                onClick={() => {
                  setAddCategoryError(null);
                  setShowAddCategory(true);
                }}
                className="mt-1 flex items-center gap-1.5 rounded-xl bg-[#E5484D] px-4 py-2 text-sm font-medium text-white hover:bg-[#D6393E]"
              >
                <PlusIcon className="h-4 w-4" /> Category
              </button>
            </div>
          )}
        </>
      )}

      {tab === "groups" && (
        <>
          {groupsQuery.isLoading && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-32 animate-pulse rounded-2xl bg-neutral-100" />
              ))}
            </div>
          )}

          {!groupsQuery.isLoading && groupsQuery.data && groupsQuery.data.length > 0 && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {groupsQuery.data.map((g) => (
                <button
                  key={g.id}
                  onClick={() => {
                    setEditingGroup(g);
                    setEditGroupError(null);
                    setDeleteGroupError(null);
                  }}
                  className="group relative flex flex-col items-center gap-1.5 rounded-2xl border border-neutral-200 bg-white p-4 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-neutral-300 opacity-0 transition-opacity group-hover:bg-neutral-50 group-hover:text-neutral-500 group-hover:opacity-100">
                    <EditIcon className="h-3.5 w-3.5" />
                  </span>
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
                    <TagIcon className="h-5 w-5" />
                  </span>
                  <p className="text-sm font-semibold text-neutral-900">{g.name}</p>
                  <span className="rounded-full bg-neutral-50 px-2.5 py-0.5 text-[11px] font-medium text-neutral-500">
                    {g.selection_type === "SINGLE" ? "Single" : "Multiple"} · {g.modifiers.length} option{g.modifiers.length === 1 ? "" : "s"}
                  </span>
                  {g.is_required && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">Required</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {!groupsQuery.isLoading && groupsQuery.data?.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/50 py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-neutral-300 shadow-sm">
                <TagIcon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-medium text-neutral-700">No modifier groups yet</p>
                <p className="mt-0.5 text-xs text-neutral-400">
                  Build reusable option sets like &quot;Size&quot; or &quot;Toppings&quot;.
                </p>
              </div>
              <button
                onClick={() => {
                  setAddGroupError(null);
                  setShowAddGroup(true);
                }}
                className="mt-1 flex items-center gap-1.5 rounded-xl bg-[#E5484D] px-4 py-2 text-sm font-medium text-white hover:bg-[#D6393E]"
              >
                <PlusIcon className="h-4 w-4" /> Group
              </button>
            </div>
          )}
        </>
      )}
    </div>
    </PermissionGate>
  );
}
