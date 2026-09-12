"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { Paginated } from "@/lib/hooks";

type StaffRow = {
  id: string;
  user: string;
  store: string;
  role: string;
  role_name: string;
  is_active: boolean;
};
type RoleOption = { id: string; name: string };

function errorMessage(err: unknown, fallback: string) {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (typeof data === "object" && data && "detail" in data) {
    return String((data as { detail: unknown }).detail);
  }
  return fallback;
}

export default function AdminStaffPage() {
  const storeId = useAuthStore((s) => s.activeStoreId);
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: staff } = useQuery<StaffRow[]>({
    queryKey: ["staff"],
    queryFn: async () => (await api.get<Paginated<StaffRow>>("/staff/")).data.results,
  });

  const { data: roles } = useQuery<RoleOption[]>({
    queryKey: ["roles"],
    queryFn: async () => (await api.get<Paginated<RoleOption>>("/roles/")).data.results,
  });

  const invite = useMutation({
    mutationFn: async () => {
      const { data: user } = await api.post("/auth/register/", {
        email,
        password,
        first_name: firstName,
      });
      return api.post("/staff/", { user: user.id, store: storeId, role: roleId });
    },
    onSuccess: () => {
      setEmail("");
      setFirstName("");
      setPassword("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (err) =>
      setError(errorMessage(err, "Could not create staff account — check the email/password.")),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Staff</h1>

      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="font-medium">Add staff member</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Name</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <Label>Role</Label>
              <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                <option value="">Select role…</option>
                {roles?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label>Temporary password</Label>
              <Input
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button
            disabled={!email || !password || !roleId || invite.isPending}
            onClick={() => invite.mutate()}
          >
            Add to store
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="divide-y divide-neutral-100 p-0">
          {staff?.map((s) => (
            <div key={s.id} className="flex items-center justify-between p-4 text-sm">
              <span>Staff {s.id.slice(0, 8)}</span>
              <Badge tone="neutral">{s.role_name}</Badge>
            </div>
          ))}
          {staff?.length === 0 && (
            <p className="p-4 text-sm text-neutral-500">No staff yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
