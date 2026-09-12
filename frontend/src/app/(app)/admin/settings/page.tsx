"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api";
import { Organization } from "@/lib/types";

export default function AdminSettingsPage() {
  const queryClient = useQueryClient();
  const { data: org } = useQuery<Organization>({
    queryKey: ["organization"],
    queryFn: async () => (await api.get("/org/")).data,
  });

  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("");

  useEffect(() => {
    if (org) {
      setName(org.name);
      setCurrency(org.currency);
    }
  }, [org]);

  const save = useMutation({
    mutationFn: async () => api.patch("/org/", { name, currency }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organization"] }),
  });

  if (!org) return <p className="text-sm text-neutral-500">Loading…</p>;

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      <Card>
        <CardContent className="space-y-4 p-4">
          <div>
            <Label>Business name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Currency</Label>
            <Input value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </div>
          <div>
            <Label>Business type</Label>
            <p className="text-sm text-neutral-600">{org.business_type.replace(/_/g, " + ")}</p>
          </div>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Save
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
