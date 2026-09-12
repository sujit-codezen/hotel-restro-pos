"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { Paginated } from "@/lib/hooks";

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

export default function RolesPage() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");

  const { data: roles, isLoading } = useQuery<Role[]>({
    queryKey: ["roles"],
    queryFn: async () => (await api.get<Paginated<Role>>("/roles/")).data.results,
  });

  const createRole = useMutation({
    mutationFn: async () => api.post("/roles/", { name: newName }),
    onSuccess: () => {
      setNewName("");
      queryClient.invalidateQueries({ queryKey: ["roles"] });
    },
  });

  const togglePermission = useMutation({
    mutationFn: async ({ role, flag }: { role: Role; flag: string }) =>
      api.patch(`/roles/${role.id}/`, { [flag]: !role[flag as keyof Role] }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["roles"] }),
  });

  const deleteRole = useMutation({
    mutationFn: async (id: string) => api.delete(`/roles/${id}/`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["roles"] }),
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: string | string[] } })?.response?.data;
      window.alert(Array.isArray(message) ? message[0] : message || "Could not delete role.");
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Roles</h1>
        <p className="text-sm text-neutral-500">
          Control what each role can do. Basic operations (taking orders, billing, holding a
          table) are open to everyone — these toggles only gate the sensitive actions.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="text-sm font-medium">Add a role</p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) createRole.mutate();
            }}
          >
            <Input
              placeholder="Role name (e.g. Shift Lead)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-64"
            />
            <Button type="submit" variant="secondary" disabled={createRole.isPending}>
              Add
            </Button>
          </form>
        </CardContent>
      </Card>

      {isLoading && <p className="text-sm text-neutral-500">Loading…</p>}

      <div className="space-y-3">
        {roles?.map((role) => (
          <Card key={role.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{role.name}</p>
                  {role.is_system && <Badge tone="neutral">default</Badge>}
                </div>
                <button
                  onClick={() => deleteRole.mutate(role.id)}
                  disabled={deleteRole.isPending}
                  className="text-xs text-neutral-400 hover:text-red-500 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {PERMISSION_FLAGS.map((flag) => (
                  <label key={flag.key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={role[flag.key]}
                      onChange={() => togglePermission.mutate({ role, flag: flag.key })}
                      disabled={togglePermission.isPending}
                    />
                    {flag.label}
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
