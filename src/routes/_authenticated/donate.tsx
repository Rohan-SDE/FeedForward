import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, PackagePlus, Trash2 } from "lucide-react";
import { cancelListing, createListing, myListings } from "@/lib/feedforward.functions";
import { useMe } from "@/hooks/useMe";
import type { Row } from "@/lib/rows";
import {
  DIET_LABELS,
  FOOD_TYPES,
  SAFE_WINDOW_HOURS,
  STORAGE_LABELS,
  type Diet,
  type StorageTemp,
} from "@/lib/food";
import { UrgencyBadge } from "@/components/UrgencyBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/donate")({
  head: () => ({
    meta: [
      { title: "Post surplus food — FeedForward" },
      {
        name: "description",
        content:
          "Post surplus food in under a minute: type, quantity, storage, safe window and pickup address — nearby NGOs get alerted instantly.",
      },
      { property: "og:title", content: "Post surplus food — FeedForward" },
      {
        property: "og:description",
        content: "List leftover food for nearby NGOs and shelters to collect.",
      },
    ],
  }),
  component: Donate,
});

function localInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Donate() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const mine = useQuery({ queryKey: ["myListings"], queryFn: useServerFn(myListings) });

  const create = useMutation({
    mutationFn: useServerFn(createListing),
    onSuccess: () => {
      toast.success("Posted — nearby NGOs can now claim it");
      qc.invalidateQueries();
      navigate({ to: "/dashboard" });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancel = useMutation({
    mutationFn: useServerFn(cancelListing),
    onSuccess: () => {
      toast.success("Listing cancelled");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const now = new Date();
  const [title, setTitle] = useState("");
  const [foodType, setFoodType] = useState<string>(FOOD_TYPES[0]);
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<"servings" | "kg">("servings");
  const [diet, setDiet] = useState<Diet>("veg");
  const [storage, setStorage] = useState<StorageTemp>("hot");
  const [allergens, setAllergens] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [preparedAt, setPreparedAt] = useState(localInput(now));
  const [bestBefore, setBestBefore] = useState(
    localInput(new Date(now.getTime() + SAFE_WINDOW_HOURS.hot * 3_600_000)),
  );
  const [address, setAddress] = useState((me?.profile?.address as string) ?? "");
  const [city, setCity] = useState((me?.profile?.city as string) ?? "");
  const [lat, setLat] = useState(me?.profile?.latitude != null ? String(me.profile.latitude) : "");
  const [lng, setLng] = useState(
    me?.profile?.longitude != null ? String(me.profile.longitude) : "",
  );

  function applyStorage(next: StorageTemp) {
    setStorage(next);
    const base = new Date(preparedAt);
    const from = Number.isNaN(base.getTime()) ? new Date() : base;
    setBestBefore(localInput(new Date(from.getTime() + SAFE_WINDOW_HOURS[next] * 3_600_000)));
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      toast.error("Location is not available in this browser");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        toast.success("Location captured");
      },
      () => toast.error("Couldn't get your location"),
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      toast.error("Enter a quantity");
      return;
    }
    if (new Date(bestBefore).getTime() <= Date.now()) {
      toast.error("Best-before must be in the future");
      return;
    }
    create.mutate({
      data: {
        title: title.trim(),
        food_type: foodType,
        description: description.trim() || null,
        quantity: qty,
        unit,
        diet,
        storage,
        allergens: allergens.trim() || null,
        photo_url: photoUrl.trim() || null,
        prepared_at: new Date(preparedAt).toISOString(),
        best_before: new Date(bestBefore).toISOString(),
        pickup_address: address.trim(),
        city: city.trim() || null,
        latitude: lat ? Number(lat) : null,
        longitude: lng ? Number(lng) : null,
      },
    });
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
      <div>
        <h1 className="text-3xl font-bold">Post surplus food</h1>
        <p className="mt-1 text-muted-foreground">
          The safe window is pre-filled from the storage type — adjust it if you know better.
        </p>

        <form onSubmit={submit} className="surface-panel mt-6 grid gap-5 p-6">
          <div className="grid gap-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              required
              minLength={3}
              maxLength={140}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="30 veg thalis from lunch service"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Food type</Label>
              <Select value={foodType} onValueChange={setFoodType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FOOD_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Diet</Label>
              <Select value={diet} onValueChange={(v) => setDiet(v as Diet)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DIET_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="qty">Quantity</Label>
              <Input
                id="qty"
                type="number"
                min={0.1}
                step={0.1}
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Unit</Label>
              <Select value={unit} onValueChange={(v) => setUnit(v as "servings" | "kg")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="servings">Servings</SelectItem>
                  <SelectItem value="kg">Kilograms</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Storage</Label>
              <Select value={storage} onValueChange={(v) => applyStorage(v as StorageTemp)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STORAGE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="prep">Prepared / packed at</Label>
              <Input
                id="prep"
                type="datetime-local"
                value={preparedAt}
                onChange={(e) => setPreparedAt(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bb">Best before</Label>
              <Input
                id="bb"
                type="datetime-local"
                value={bestBefore}
                onChange={(e) => setBestBefore(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="desc">Description</Label>
            <Textarea
              id="desc"
              maxLength={1000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Packed in sealed foil trays, needs reheating."
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="allerg">Allergens</Label>
              <Input
                id="allerg"
                maxLength={300}
                value={allergens}
                onChange={(e) => setAllergens(e.target.value)}
                placeholder="Peanuts, dairy"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="photo">Photo URL</Label>
              <Input
                id="photo"
                type="url"
                maxLength={600}
                value={photoUrl}
                onChange={(e) => setPhotoUrl(e.target.value)}
                placeholder="https://…"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="addr">Pickup address</Label>
            <Input
              id="addr"
              required
              minLength={4}
              maxLength={300}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                maxLength={120}
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="lat">Latitude</Label>
              <Input id="lat" value={lat} onChange={(e) => setLat(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="lng">Longitude</Label>
              <Input id="lng" value={lng} onChange={(e) => setLng(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <PackagePlus className="mr-2 size-4" />
              )}
              Post surplus
            </Button>
            <Button type="button" variant="outline" onClick={useMyLocation}>
              Use my current location
            </Button>
          </div>
        </form>
      </div>

      <aside className="grid gap-4">
        <h2 className="text-lg font-semibold">My posts</h2>
        {(mine.data ?? []).map((l: Row) => (
          <div key={l.id} className="surface-panel p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{l.title}</p>
                <p className="text-xs text-muted-foreground">
                  {l.claimed_quantity ?? 0}/{l.quantity} {l.unit} claimed
                </p>
              </div>
              <UrgencyBadge bestBefore={l.best_before} status={l.status} />
            </div>
            {["posted", "claimed"].includes(l.status) && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-2 text-destructive"
                onClick={() => cancel.mutate({ data: { id: l.id as string } })}
              >
                <Trash2 className="mr-1 size-3" /> Cancel listing
              </Button>
            )}
          </div>
        ))}
        {!mine.isLoading && !(mine.data ?? []).length && (
          <p className="text-sm text-muted-foreground">Your posts will show up here.</p>
        )}
      </aside>
    </div>
  );
}
