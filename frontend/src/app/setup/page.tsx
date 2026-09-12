"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

type BusinessType = "RESTAURANT" | "HOTEL" | "HOTEL_RESTAURANT";

const OPTIONS: { value: BusinessType; label: string; description: string }[] = [
  { value: "RESTAURANT", label: "Restaurant", description: "Tables, menu, kitchen, billing" },
  { value: "HOTEL", label: "Hotel", description: "Rooms, reservations, folios" },
  {
    value: "HOTEL_RESTAURANT",
    label: "Hotel + Restaurant",
    description: "Both, with charge-to-room billing",
  },
];

export default function SetupPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [businessType, setBusinessType] = useState<BusinessType>("RESTAURANT");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Business name is required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.post("/org/onboarding/", { name, business_type: businessType });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      router.replace("/dashboard");
    } catch {
      setError("Could not complete setup. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-lg">Set up your business</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label htmlFor="name">Business name</Label>
            <Input
              id="name"
              placeholder="e.g. Himal Resort"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <Label>What do you run?</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setBusinessType(opt.value)}
                  className={cn(
                    "rounded-md border p-3 text-left text-sm transition-colors",
                    businessType === opt.value
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-300 hover:bg-neutral-50"
                  )}
                >
                  <div className="font-medium">{opt.label}</div>
                  <div
                    className={cn(
                      "mt-1 text-xs",
                      businessType === opt.value ? "text-neutral-300" : "text-neutral-500"
                    )}
                  >
                    {opt.description}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button className="w-full" onClick={handleSubmit} disabled={loading}>
            {loading ? "Setting up…" : "Continue"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
