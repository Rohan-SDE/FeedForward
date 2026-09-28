import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useMemo, useState } from "react";
import { toast } from "sonner";
import { MapPin, Search, SlidersHorizontal } from "lucide-react";
import { browseListings, claimListing } from "@/lib/feedforward.functions";
import { useMe } from "@/hooks/useMe";
import type { Row } from "@/lib/rows";
import {
  DIET_LABELS,
  STORAGE_LABELS,
  distanceKm,
  timeLeftLabel,
  urgencyOf,
  type Diet,
  type StorageTemp,
} from "@/lib/food";
import { UrgencyBadge } from "@/components/UrgencyBadge";
import FoodPhoto from "@/components/FoodPhoto";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const NearbyMap = lazy(() => import("@/components/NearbyMap"));

export const Route = createFileRoute("/_authenticated/listings")({
  head: () => ({
    meta: [
      { title: "Nearby surplus food — FeedForward" },
      {
        name: "description",
        content:
          "Browse surplus food donations near you, filter by diet and freshness, and claim what your organisation can collect in time.",
      },
      { property: "og:title", content: "Nearby surplus food — FeedForward" },
      {
        property: "og:description",
        content: "Live map and list of claimable surplus food donations.",
      },
    ],
  }),
  component: Listings,
});

function Listings() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const canClaim = !!me?.roles.includes("ngo");
  const listings = useQuery({
    queryKey: ["browse"],
    queryFn: browseListings,
    refetchInterval: 10_000,
  });
  const claim = useMutation({
    mutationFn: claimListing,
    onSuccess: () => {
      toast.success("Claimed — now schedule the pickup");
      setActive(null);
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [q, setQ] = useState("");
  const [diet, setDiet] = useState<Diet | "any">("any");
  const [storage, setStorage] = useState<StorageTemp | "any">("any");
  const [maxKm, setMaxKm] = useState("");
  const [hideExpired, setHideExpired] = useState(true);
  const [active, setActive] = useState<Row | null>(null);
  const [claimQty, setClaimQty] = useState("");
  const [note, setNote] = useState("");

  const myLat = me?.profile?.latitude as number | null | undefined;
  const myLng = me?.profile?.longitude as number | null | undefined;

  const rows = useMemo(() => {
    const list = (listings.data ?? []) as Row[];
    return list
      .map((l) => ({
        ...l,
        remaining: Number(l.quantity) - Number(l.claimed_quantity ?? 0),
        km:
          myLat != null && myLng != null && l.latitude != null && l.longitude != null
            ? distanceKm(myLat, myLng, Number(l.latitude), Number(l.longitude))
            : null,
      }))
      .filter((l) => {
        if (hideExpired && urgencyOf(l.best_before) === "expired") return false;
        if (l.remaining <= 0) return false;
        if (diet !== "any" && l.diet !== diet) return false;
        if (storage !== "any" && l.storage !== storage) return false;
        if (maxKm && l.km != null && l.km > Number(maxKm)) return false;
        const needle = q.trim().toLowerCase();
        if (needle && !`${l.title} ${l.food_type} ${l.city ?? ""}`.toLowerCase().includes(needle))
          return false;
        return true;
      })
      .sort((a, b) => {
        if (a.km != null && b.km != null) return a.km - b.km;
        return new Date(a.best_before).getTime() - new Date(b.best_before).getTime();
      });
  }, [listings.data, q, diet, storage, maxKm, hideExpired, myLat, myLng]);

  const markers = rows
    .filter((l) => l.latitude != null && l.longitude != null)
    .map((l) => ({
      id: l.id as string,
      lat: Number(l.latitude),
      lng: Number(l.longitude),
      title: l.title as string,
      urgency: urgencyOf(l.best_before),
    }));

  const center =
    myLat != null && myLng != null
      ? { lat: myLat, lng: myLng }
      : markers[0]
        ? { lat: markers[0].lat, lng: markers[0].lng }
        : { lat: 19.076, lng: 72.8777 };

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-3xl font-bold">Nearby surplus food</h1>
        <p className="mt-1 text-muted-foreground">
          {rows.length} claimable {rows.length === 1 ? "donation" : "donations"}
          {myLat == null && " · add your location in Profile to sort by distance"}
        </p>
      </div>

      <div className="surface-panel grid gap-4 p-5 md:grid-cols-5">
        <div className="md:col-span-2">
          <Label htmlFor="q" className="text-xs uppercase tracking-wide text-muted-foreground">
            Search
          </Label>
          <div className="relative mt-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="q"
              className="pl-9"
              maxLength={80}
              placeholder="Biryani, bakery, area…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Diet</Label>
          <Select value={diet} onValueChange={(v) => setDiet(v as Diet | "any")}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              {Object.entries(DIET_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Storage</Label>
          <Select value={storage} onValueChange={(v) => setStorage(v as StorageTemp | "any")}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              {Object.entries(STORAGE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="km" className="text-xs uppercase tracking-wide text-muted-foreground">
            Within km
          </Label>
          <Input
            id="km"
            className="mt-1"
            type="number"
            min={1}
            max={200}
            value={maxKm}
            onChange={(e) => setMaxKm(e.target.value)}
            placeholder="Any"
          />
        </div>
        <div className="md:col-span-5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setHideExpired((v) => !v)}
            className="text-muted-foreground"
          >
            <SlidersHorizontal className="mr-1 size-4" />
            {hideExpired ? "Hiding past best-before" : "Showing past best-before"}
          </Button>
        </div>
      </div>

      <Suspense
        fallback={<div className="h-72 animate-pulse rounded-xl border border-border bg-muted" />}
      >
        <NearbyMap markers={markers} center={center} />
      </Suspense>

      <div className="grid gap-4 md:grid-cols-2">
        {rows.map((l) => (
          <article key={l.id} className="surface-panel flex flex-col gap-3 p-5">
            <FoodPhoto src={l.photo_url} alt={`${l.title} food`} className="h-44 w-full" />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold">{l.title}</h2>
                <p className="text-sm text-muted-foreground">
                  {l.food_type} · {DIET_LABELS[l.diet as Diet]} ·{" "}
                  {STORAGE_LABELS[l.storage as StorageTemp]}
                </p>
              </div>
              <UrgencyBadge bestBefore={l.best_before} showTime />
            </div>

            {l.description && (
              <p className="line-clamp-2 text-sm text-muted-foreground">{l.description}</p>
            )}

            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Available</dt>
                <dd className="font-semibold">
                  {l.remaining} {l.unit}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Best before</dt>
                <dd className="font-semibold">{timeLeftLabel(l.best_before)}</dd>
              </div>
            </dl>

            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 size-4 shrink-0" />
              <span>
                {l.city ?? "Approximate area"} · exact address shared once claimed
                {l.km != null && (
                  <span className="font-medium text-foreground"> · {l.km.toFixed(1)} km away</span>
                )}
              </span>
            </p>

            <div className="mt-auto flex items-center justify-between gap-3 pt-2">
              <span className="text-xs text-muted-foreground">
                {l.donor?.org_name ?? l.donor?.full_name ?? "Donor"}
                {l.donor?.verified && " · verified"}
              </span>
              <Button
                size="sm"
                disabled={!canClaim}
                title={canClaim ? "Claim this food" : "Only NGO accounts can claim food"}
                onClick={() => {
                  setActive(l);
                  setClaimQty(String(l.remaining));
                  setNote("");
                }}
              >
                {canClaim ? "Claim food" : "NGO account required"}
              </Button>
            </div>
          </article>
        ))}
        {!listings.isLoading && !rows.length && (
          <p className="text-sm text-muted-foreground">
            No donations match these filters right now.
          </p>
        )}
      </div>

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Claim {active?.title}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="cq">
                Quantity ({active?.unit}) — {active?.remaining} available
              </Label>
              <Input
                id="cq"
                type="number"
                min={0.1}
                step={0.1}
                max={active?.remaining}
                value={claimQty}
                onChange={(e) => setClaimQty(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cn">Note to donor</Label>
              <Input
                id="cn"
                maxLength={400}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="We'll send a van around 7pm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActive(null)}>
              Cancel
            </Button>
            <Button
              disabled={claim.isPending}
              onClick={() => {
                const qty = Number(claimQty);
                if (!qty || qty <= 0) {
                  toast.error("Enter a valid quantity");
                  return;
                }
                claim.mutate({
                  data: {
                    listing_id: active!.id as string,
                    claimed_quantity: qty,
                    note: note.trim() || null,
                  },
                });
              }}
            >
              Confirm claim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
