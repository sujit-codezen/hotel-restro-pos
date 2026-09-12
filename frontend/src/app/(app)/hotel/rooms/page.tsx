"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { BedIcon, DoorIcon, EditIcon, PlusIcon, SparkleIcon, TagIcon, UsersIcon } from "@/components/ui/icons";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { Paginated } from "@/lib/hooks";
import { Room, RoomStatus, RoomType } from "@/lib/types";
import { cn, formatCurrency } from "@/lib/utils";

const STATUS_STYLE: Record<
  RoomStatus,
  { label: string; dot: string; tile: string; pill: string; ring: string }
> = {
  AVAILABLE: {
    label: "Available",
    dot: "bg-emerald-500",
    tile: "border-emerald-100 bg-white",
    pill: "bg-emerald-50 text-emerald-700",
    ring: "ring-emerald-100",
  },
  OCCUPIED: {
    label: "Occupied",
    dot: "bg-[#E5484D]",
    tile: "border-[#F5C6C7] bg-gradient-to-b from-[#FDECEC] to-white",
    pill: "bg-[#FDECEC] text-[#C5323A]",
    ring: "ring-[#F5C6C7]",
  },
  DIRTY: {
    label: "Dirty",
    dot: "bg-amber-500",
    tile: "border-amber-200 bg-gradient-to-b from-amber-50 to-white",
    pill: "bg-amber-50 text-amber-700",
    ring: "ring-amber-100",
  },
  MAINTENANCE: {
    label: "Maintenance",
    dot: "bg-neutral-400",
    tile: "border-neutral-200 bg-neutral-50",
    pill: "bg-neutral-100 text-neutral-600",
    ring: "ring-neutral-200",
  },
};

const STATUS_OPTIONS: RoomStatus[] = ["AVAILABLE", "OCCUPIED", "DIRTY", "MAINTENANCE"];

// Rotating avatar palette for room-type cards — purely decorative, gives
// each type a distinct identity at a glance without needing user input.
const TYPE_PALETTE = [
  "bg-gradient-to-br from-rose-400 to-[#E5484D]",
  "bg-gradient-to-br from-amber-400 to-orange-500",
  "bg-gradient-to-br from-sky-400 to-blue-500",
  "bg-gradient-to-br from-violet-400 to-purple-500",
  "bg-gradient-to-br from-emerald-400 to-teal-500",
];

type RoomTypeFormValues = { name: string; base_rate: string; capacity: number };
type RoomFormValues = { room_type: string; number: string; floor: string; status: RoomStatus };

function errorMessage(err: unknown, fallback: string) {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  // A ValidationError raised as a plain string outside a serializer (e.g.
  // RoomTypeViewSet/RoomViewSet's perform_destroy guards) comes back as a
  // bare top-level array, not {detail: ...} or {field: [...]}.
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
  onClose,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
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
          {icon && (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FDECEC] text-[#E5484D]">
              {icon}
            </span>
          )}
          <p className="flex-1 font-semibold text-neutral-900">{title}</p>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DeleteSection({
  label,
  onDelete,
  deleting,
  deleteError,
}: {
  label: string;
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
          <p className="text-sm text-red-700">This can&apos;t be undone.</p>
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

/** Shared popup for both creating and editing a room type. */
function RoomTypeFormModal({
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
  initial: RoomTypeFormValues;
  onClose: () => void;
  onSubmit: (values: RoomTypeFormValues) => void;
  submitting: boolean;
  submitLabel: string;
  error: string | null;
  onDelete?: () => void;
  deleting?: boolean;
  deleteError?: string | null;
}) {
  const [name, setName] = useState(initial.name);
  const [baseRate, setBaseRate] = useState(initial.base_rate);
  const [capacity, setCapacity] = useState(initial.capacity);
  const valid = name.trim() && baseRate.trim();

  return (
    <ModalShell title={title} icon={<BedIcon className="h-5 w-5" />} onClose={onClose}>
      <div className="space-y-4 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Room type name</label>
          <input
            autoFocus
            placeholder="e.g. Deluxe"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
          />
          <p className="mt-1 text-xs text-neutral-400">Must be unique for this store.</p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Base rate / night</label>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="e.g. 2000"
            value={baseRate}
            onChange={(e) => setBaseRate(e.target.value)}
            className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
          />
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
            <span className="text-xs text-neutral-400">guests</span>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {onDelete && (
          <DeleteSection
            label="Delete room type"
            onDelete={onDelete}
            deleting={deleting}
            deleteError={deleteError}
          />
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
          onClick={() => valid && onSubmit({ name, base_rate: baseRate, capacity })}
          disabled={!valid || submitting}
          className="flex-1 rounded-xl bg-[#E5484D] py-2.5 text-sm font-medium text-white hover:bg-[#D6393E] disabled:opacity-60"
        >
          {submitting ? `${submitLabel}…` : submitLabel}
        </button>
      </div>
    </ModalShell>
  );
}

/** Shared popup for both creating and editing a room. */
function RoomFormModal({
  title,
  initial,
  roomTypes,
  onClose,
  onSubmit,
  submitting,
  submitLabel,
  error,
  onDelete,
  deleting,
  deleteError,
  showStatus,
}: {
  title: string;
  initial: RoomFormValues;
  roomTypes: RoomType[];
  onClose: () => void;
  onSubmit: (values: RoomFormValues) => void;
  submitting: boolean;
  submitLabel: string;
  error: string | null;
  onDelete?: () => void;
  deleting?: boolean;
  deleteError?: string | null;
  showStatus?: boolean;
}) {
  const [roomType, setRoomType] = useState(initial.room_type);
  const [number, setNumber] = useState(initial.number);
  const [floor, setFloor] = useState(initial.floor);
  const [status, setStatus] = useState<RoomStatus>(initial.status);
  const valid = roomType && number.trim();

  return (
    <ModalShell title={title} icon={<DoorIcon className="h-5 w-5" />} onClose={onClose}>
      <div className="space-y-4 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Room type</label>
          <select
            value={roomType}
            onChange={(e) => setRoomType(e.target.value)}
            className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
          >
            <option value="">Select room type…</option>
            {roomTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Room number</label>
          <input
            autoFocus
            placeholder="e.g. 101"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
          />
          <p className="mt-1 text-xs text-neutral-400">Must be unique for this store.</p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Floor</label>
          <input
            placeholder="e.g. 2 (optional)"
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
            className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#E5484D]"
          />
        </div>

        {showStatus && (
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">Status</label>
            <div className="grid grid-cols-2 gap-2">
              {STATUS_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={cn(
                    "rounded-xl border py-2 text-sm font-medium transition-colors",
                    status === s
                      ? "border-[#E5484D] bg-[#FDECEC] text-[#E5484D]"
                      : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                  )}
                >
                  {STATUS_STYLE[s].label}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        {onDelete && (
          <DeleteSection label="Delete room" onDelete={onDelete} deleting={deleting} deleteError={deleteError} />
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
          onClick={() => valid && onSubmit({ room_type: roomType, number, floor, status })}
          disabled={!valid || submitting}
          className="flex-1 rounded-xl bg-[#E5484D] py-2.5 text-sm font-medium text-white hover:bg-[#D6393E] disabled:opacity-60"
        >
          {submitting ? `${submitLabel}…` : submitLabel}
        </button>
      </div>
    </ModalShell>
  );
}

export default function HotelRoomsPage() {
  const storeId = useAuthStore((s) => s.activeStoreId);
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<"rooms" | "types">("rooms");

  const [showAddType, setShowAddType] = useState(false);
  const [addTypeError, setAddTypeError] = useState<string | null>(null);
  const [editingType, setEditingType] = useState<RoomType | null>(null);
  const [editTypeError, setEditTypeError] = useState<string | null>(null);
  const [deleteTypeError, setDeleteTypeError] = useState<string | null>(null);

  const [showAddRoom, setShowAddRoom] = useState(false);
  const [addRoomError, setAddRoomError] = useState<string | null>(null);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [editRoomError, setEditRoomError] = useState<string | null>(null);
  const [deleteRoomError, setDeleteRoomError] = useState<string | null>(null);

  const { data: roomTypes, isLoading: typesLoading } = useQuery<RoomType[]>({
    queryKey: ["room-types", storeId],
    queryFn: async () =>
      (await api.get<Paginated<RoomType>>("/room-types/", { params: { store: storeId } })).data
        .results,
    enabled: !!storeId,
  });

  const { data: rooms, isLoading: roomsLoading } = useQuery<Room[]>({
    queryKey: ["rooms", storeId],
    queryFn: async () =>
      (await api.get<Paginated<Room>>("/rooms/", { params: { store: storeId } })).data.results,
    enabled: !!storeId,
  });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["room-types", storeId] });
    queryClient.invalidateQueries({ queryKey: ["rooms", storeId] });
  }

  const createRoomType = useMutation({
    mutationFn: async (values: RoomTypeFormValues) =>
      api.post("/room-types/", { store: storeId, ...values }),
    onSuccess: () => {
      setShowAddType(false);
      setAddTypeError(null);
      invalidateAll();
    },
    onError: (err: unknown) =>
      setAddTypeError(errorMessage(err, "Could not create the room type — check the name and try again.")),
  });

  const updateRoomType = useMutation({
    mutationFn: async (values: RoomTypeFormValues) => api.patch(`/room-types/${editingType!.id}/`, values),
    onSuccess: () => {
      setEditingType(null);
      setEditTypeError(null);
      invalidateAll();
    },
    onError: (err: unknown) =>
      setEditTypeError(errorMessage(err, "Could not save changes — check the name and try again.")),
  });

  const deleteRoomType = useMutation({
    mutationFn: async () => api.delete(`/room-types/${editingType!.id}/`),
    onSuccess: () => {
      setEditingType(null);
      setDeleteTypeError(null);
      invalidateAll();
    },
    onError: (err: unknown) => setDeleteTypeError(errorMessage(err, "Could not delete this room type.")),
  });

  const createRoom = useMutation({
    mutationFn: async (values: RoomFormValues) =>
      api.post("/rooms/", { store: storeId, room_type: values.room_type, number: values.number, floor: values.floor }),
    onSuccess: () => {
      setShowAddRoom(false);
      setAddRoomError(null);
      invalidateAll();
    },
    onError: (err: unknown) =>
      setAddRoomError(errorMessage(err, "Could not create the room — check the number and try again.")),
  });

  const updateRoom = useMutation({
    mutationFn: async (values: RoomFormValues) => api.patch(`/rooms/${editingRoom!.id}/`, values),
    onSuccess: () => {
      setEditingRoom(null);
      setEditRoomError(null);
      invalidateAll();
    },
    onError: (err: unknown) =>
      setEditRoomError(errorMessage(err, "Could not save changes — check the number and try again.")),
  });

  const deleteRoom = useMutation({
    mutationFn: async () => api.delete(`/rooms/${editingRoom!.id}/`),
    onSuccess: () => {
      setEditingRoom(null);
      setDeleteRoomError(null);
      invalidateAll();
    },
    onError: (err: unknown) => setDeleteRoomError(errorMessage(err, "Could not delete this room.")),
  });

  const markClean = useMutation({
    mutationFn: async (room: Room) => api.patch(`/rooms/${room.id}/`, { status: "AVAILABLE" }),
    onSuccess: invalidateAll,
  });

  const counts = (rooms ?? []).reduce(
    (acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }),
    {} as Partial<Record<RoomStatus, number>>
  );

  const roomCountByType = (rooms ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.room_type] = (acc[r.room_type] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Rooms</h1>
          <p className="mt-0.5 text-sm text-neutral-500">Manage your room types and inventory in one place.</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="flex rounded-xl bg-neutral-100 p-1 text-sm font-medium">
            <button
              onClick={() => setTab("rooms")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-4 py-1.5 transition-all",
                tab === "rooms" ? "bg-white text-[#E5484D] shadow-sm" : "text-neutral-500 hover:text-neutral-700"
              )}
            >
              <DoorIcon className="h-4 w-4" /> Rooms ({rooms?.length ?? 0})
            </button>
            <button
              onClick={() => setTab("types")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-4 py-1.5 transition-all",
                tab === "types" ? "bg-white text-[#E5484D] shadow-sm" : "text-neutral-500 hover:text-neutral-700"
              )}
            >
              <TagIcon className="h-4 w-4" /> Room Types ({roomTypes?.length ?? 0})
            </button>
          </div>

          {tab === "rooms" ? (
            <button
              onClick={() => {
                setAddRoomError(null);
                setShowAddRoom(true);
              }}
              disabled={!roomTypes || roomTypes.length === 0}
              className="flex h-10 items-center gap-1.5 rounded-xl bg-[#E5484D] px-4 text-sm font-medium text-white shadow-sm shadow-[#E5484D]/20 transition-all hover:-translate-y-px hover:bg-[#D6393E] hover:shadow-md hover:shadow-[#E5484D]/30 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-50 disabled:shadow-none"
            >
              <PlusIcon className="h-4 w-4" /> Room
            </button>
          ) : (
            <button
              onClick={() => {
                setAddTypeError(null);
                setShowAddType(true);
              }}
              className="flex h-10 items-center gap-1.5 rounded-xl bg-[#E5484D] px-4 text-sm font-medium text-white shadow-sm shadow-[#E5484D]/20 transition-all hover:-translate-y-px hover:bg-[#D6393E] hover:shadow-md hover:shadow-[#E5484D]/30"
            >
              <PlusIcon className="h-4 w-4" /> Room type
            </button>
          )}
        </div>
      </div>

      {tab === "rooms" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STATUS_OPTIONS.map((status) => {
            const style = STATUS_STYLE[status];
            return (
              <div
                key={status}
                className={cn(
                  "flex items-center gap-3 rounded-2xl border p-3.5 shadow-sm ring-1 ring-inset",
                  style.tile,
                  style.ring
                )}
              >
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", style.dot)} />
                <div className="min-w-0">
                  <p className="text-xl font-semibold leading-none text-neutral-900">
                    {counts[status] ?? 0}
                  </p>
                  <p className="mt-1 truncate text-xs font-medium text-neutral-500">{style.label}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAddType && (
        <RoomTypeFormModal
          title="Add a room type"
          initial={{ name: "", base_rate: "", capacity: 2 }}
          onClose={() => setShowAddType(false)}
          onSubmit={(values) => createRoomType.mutate(values)}
          submitting={createRoomType.isPending}
          submitLabel="Create room type"
          error={addTypeError}
        />
      )}

      {editingType && (
        <RoomTypeFormModal
          title={`Edit ${editingType.name}`}
          initial={{ name: editingType.name, base_rate: editingType.base_rate, capacity: editingType.capacity }}
          onClose={() => setEditingType(null)}
          onSubmit={(values) => updateRoomType.mutate(values)}
          submitting={updateRoomType.isPending}
          submitLabel="Save changes"
          error={editTypeError}
          onDelete={() => deleteRoomType.mutate()}
          deleting={deleteRoomType.isPending}
          deleteError={deleteTypeError}
        />
      )}

      {showAddRoom && (
        <RoomFormModal
          title="Add a room"
          initial={{ room_type: roomTypes?.[0]?.id ?? "", number: "", floor: "", status: "AVAILABLE" }}
          roomTypes={roomTypes ?? []}
          onClose={() => setShowAddRoom(false)}
          onSubmit={(values) => createRoom.mutate(values)}
          submitting={createRoom.isPending}
          submitLabel="Create room"
          error={addRoomError}
        />
      )}

      {editingRoom && (
        <RoomFormModal
          title={`Edit room ${editingRoom.number}`}
          initial={{
            room_type: editingRoom.room_type,
            number: editingRoom.number,
            floor: editingRoom.floor,
            status: editingRoom.status,
          }}
          roomTypes={roomTypes ?? []}
          onClose={() => setEditingRoom(null)}
          onSubmit={(values) => updateRoom.mutate(values)}
          submitting={updateRoom.isPending}
          submitLabel="Save changes"
          error={editRoomError}
          onDelete={() => deleteRoom.mutate()}
          deleting={deleteRoom.isPending}
          deleteError={deleteRoomError}
          showStatus
        />
      )}

      {tab === "types" ? (
        <>
          {typesLoading && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-40 animate-pulse rounded-2xl bg-neutral-100" />
              ))}
            </div>
          )}

          {!typesLoading && roomTypes && roomTypes.length > 0 && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {roomTypes.map((rt, i) => (
                <button
                  key={rt.id}
                  onClick={() => {
                    setEditingType(rt);
                    setEditTypeError(null);
                    setDeleteTypeError(null);
                  }}
                  className="group relative flex flex-col items-center gap-1.5 rounded-2xl border border-neutral-200 bg-white p-4 pt-5 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-lg"
                >
                  <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-neutral-300 opacity-0 transition-opacity group-hover:bg-neutral-50 group-hover:text-neutral-500 group-hover:opacity-100">
                    <EditIcon className="h-3.5 w-3.5" />
                  </span>

                  <span
                    className={cn(
                      "flex h-11 w-11 items-center justify-center rounded-full text-white shadow-sm",
                      TYPE_PALETTE[i % TYPE_PALETTE.length]
                    )}
                  >
                    <BedIcon className="h-5 w-5" />
                  </span>

                  <p className="text-sm font-semibold text-neutral-900">{rt.name}</p>

                  <p className="flex items-center gap-1 text-sm font-medium text-neutral-700">
                    {formatCurrency(rt.base_rate)}
                    <span className="text-xs font-normal text-neutral-400">/night</span>
                  </p>

                  <p className="flex items-center gap-1 text-xs text-neutral-400">
                    <UsersIcon className="h-3.5 w-3.5" /> {rt.capacity} guests
                  </p>

                  <span className="mt-1 rounded-full bg-neutral-50 px-2.5 py-0.5 text-[11px] font-medium text-neutral-500">
                    {roomCountByType[rt.id] ?? 0} room{roomCountByType[rt.id] === 1 ? "" : "s"}
                  </span>
                </button>
              ))}
            </div>
          )}

          {!typesLoading && roomTypes?.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/50 py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-neutral-300 shadow-sm">
                <TagIcon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-medium text-neutral-700">No room types yet</p>
                <p className="mt-0.5 text-xs text-neutral-400">
                  Add one to start building your room inventory.
                </p>
              </div>
              <button
                onClick={() => {
                  setAddTypeError(null);
                  setShowAddType(true);
                }}
                className="mt-1 flex items-center gap-1.5 rounded-xl bg-[#E5484D] px-4 py-2 text-sm font-medium text-white hover:bg-[#D6393E]"
              >
                <PlusIcon className="h-4 w-4" /> Room type
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          {roomsLoading && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-40 animate-pulse rounded-2xl bg-neutral-100" />
              ))}
            </div>
          )}

          {!roomsLoading && roomTypes?.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/50 py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-neutral-300 shadow-sm">
                <BedIcon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-medium text-neutral-700">Create a room type first</p>
                <p className="mt-0.5 text-xs text-neutral-400">
                  Rooms need a type before they can be added.
                </p>
              </div>
              <button
                onClick={() => setTab("types")}
                className="mt-1 flex items-center gap-1.5 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
              >
                <TagIcon className="h-4 w-4" /> Go to Room Types
              </button>
            </div>
          )}

          {!roomsLoading && roomTypes && roomTypes.length > 0 && rooms && rooms.length > 0 && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {rooms.map((room) => {
                const style = STATUS_STYLE[room.status];
                return (
                  <div
                    key={room.id}
                    className={cn(
                      "group relative flex flex-col items-center gap-1.5 rounded-2xl border p-3.5 pt-4 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg",
                      style.tile
                    )}
                  >
                    <button
                      onClick={() => {
                        setEditingRoom(room);
                        setEditRoomError(null);
                        setDeleteRoomError(null);
                      }}
                      className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-neutral-400 opacity-0 shadow-sm transition-opacity hover:bg-white hover:text-neutral-600 group-hover:opacity-100"
                      aria-label={`Edit room ${room.number}`}
                    >
                      <EditIcon className="h-3.5 w-3.5" />
                    </button>

                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", style.pill)}>
                      {room.room_type_name}
                    </span>

                    <p className="text-2xl font-bold leading-tight text-neutral-900">{room.number}</p>

                    {room.floor && (
                      <p className="text-xs text-neutral-400">Floor {room.floor}</p>
                    )}

                    <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-600">
                      <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
                      {style.label}
                    </span>

                    {room.status === "DIRTY" && (
                      <button
                        onClick={() => markClean.mutate(room)}
                        disabled={markClean.isPending}
                        className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg bg-neutral-900 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-800 disabled:opacity-60"
                      >
                        <SparkleIcon className="h-3.5 w-3.5" />
                        {markClean.isPending ? "Cleaning…" : "Mark clean"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!roomsLoading && roomTypes && roomTypes.length > 0 && rooms?.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/50 py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-neutral-300 shadow-sm">
                <DoorIcon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-medium text-neutral-700">No rooms yet</p>
                <p className="mt-0.5 text-xs text-neutral-400">Add your first room to get started.</p>
              </div>
              <button
                onClick={() => {
                  setAddRoomError(null);
                  setShowAddRoom(true);
                }}
                className="mt-1 flex items-center gap-1.5 rounded-xl bg-[#E5484D] px-4 py-2 text-sm font-medium text-white hover:bg-[#D6393E]"
              >
                <PlusIcon className="h-4 w-4" /> Room
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
