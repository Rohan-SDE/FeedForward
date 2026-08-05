import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { saveProfile } from "@/lib/feedforward.functions";
import { useMe } from "@/hooks/useMe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Profile & service area — FeedForward" },
      {
        name: "description",
        content:
          "Set your organisation details, pickup address and service radius so FeedForward can match you with the closest food donations.",
      },
      { property: "og:title", content: "Profile & service area — FeedForward" },
      {
        property: "og:description",
        content: "Manage organisation details and your service radius.",
      },
    ],
  }),
  component: Profile,
});

function Profile() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const save = useMutation({
    mutationFn: useServerFn(saveProfile),
    onSuccess: () => {
      toast.success("Profile saved");
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [form, setForm] = useState({
    full_name: "",
    org_name: "",
    phone: "",
    address: "",
    city: "",
    latitude: "",
    longitude: "",
    service_radius_km: "10",
  });

  useEffect(() => {
    if (!me?.profile) return;
    const p = me.profile;
    setForm({
      full_name: p.full_name ?? "",
      org_name: p.org_name ?? "",
      phone: p.phone ?? "",
      address: p.address ?? "",
      city: p.city ?? "",
      latitude: p.latitude != null ? String(p.latitude) : "",
      longitude: p.longitude != null ? String(p.longitude) : "",
      service_radius_km: p.service_radius_km != null ? String(p.service_radius_km) : "10",
    });
  }, [me?.profile]);

  function set(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function locate() {
    if (!navigator.geolocation) {
      toast.error("Location is not available in this browser");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set("latitude", pos.coords.latitude.toFixed(6));
        set("longitude", pos.coords.longitude.toFixed(6));
        toast.success("Location captured");
      },
      () => toast.error("Couldn't get your location"),
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim()) {
      toast.error("Name is required");
      return;
    }
    save.mutate({
      data: {
        full_name: form.full_name.trim(),
        org_name: form.org_name.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        latitude: form.latitude ? Number(form.latitude) : null,
        longitude: form.longitude ? Number(form.longitude) : null,
        service_radius_km: form.service_radius_km ? Number(form.service_radius_km) : 10,
      },
    });
  }

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6">
      <div>
        <h1 className="text-3xl font-bold">Profile & service area</h1>
        <p className="mt-1 text-muted-foreground">
          Your coordinates power distance sorting, nearby alerts and route optimisation.
        </p>
        {me?.roles?.length ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Roles: <span className="font-medium text-foreground">{me.roles.join(", ")}</span>
            {me.profile?.verified ? " · verified" : " · pending verification"}
          </p>
        ) : null}
      </div>

      <form onSubmit={submit} className="surface-panel grid gap-5 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="fn">Full name</Label>
            <Input
              id="fn"
              required
              maxLength={120}
              value={form.full_name}
              onChange={(e) => set("full_name", e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="on">Organisation</Label>
            <Input
              id="on"
              maxLength={160}
              value={form.org_name}
              onChange={(e) => set("org_name", e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="ph">Phone</Label>
            <Input
              id="ph"
              maxLength={32}
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ct">City</Label>
            <Input
              id="ct"
              maxLength={120}
              value={form.city}
              onChange={(e) => set("city", e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="ad">Address</Label>
          <Input
            id="ad"
            maxLength={300}
            value={form.address}
            onChange={(e) => set("address", e.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="la">Latitude</Label>
            <Input
              id="la"
              value={form.latitude}
              onChange={(e) => set("latitude", e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lo">Longitude</Label>
            <Input
              id="lo"
              value={form.longitude}
              onChange={(e) => set("longitude", e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sr">Service radius (km)</Label>
            <Input
              id="sr"
              type="number"
              min={1}
              max={200}
              value={form.service_radius_km}
              onChange={(e) => set("service_radius_km", e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={save.isPending}>
            Save profile
          </Button>
          <Button type="button" variant="outline" onClick={locate}>
            Use my current location
          </Button>
        </div>
      </form>
    </div>
  );
}
