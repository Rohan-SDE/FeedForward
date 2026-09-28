import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Bell,
  CalendarClock,
  KeyRound,
  MapPin,
  Navigation,
  Route as RouteIcon,
} from "lucide-react";
import {
  acceptDeliveryRequest,
  advancePickup,
  cancelClaim,
  listMyDeliveryPins,
  listNearbyDeliveryRequests,
  listPickups,
  myClaims,
  optimizeRoute,
  schedulePickup,
  verifyDeliveryPin,
} from "@/lib/feedforward.functions";
import { useMe } from "@/hooks/useMe";
import type { Row } from "@/lib/rows";
import { UrgencyBadge } from "@/components/UrgencyBadge";
import FoodPhoto from "@/components/FoodPhoto";
import FeedbackSection from "@/components/FeedbackSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/pickups")({
  head: () => ({
    meta: [
      { title: "Pickups & routes — FeedForward" },
      {
        name: "description",
        content:
          "Schedule pickups for claimed food, track status from en route to delivered, and optimise multi-stop collection routes.",
      },
      { property: "og:title", content: "Pickups & routes — FeedForward" },
      {
        property: "og:description",
        content: "Schedule, track and optimise food rescue pickups.",
      },
    ],
  }),
  component: Pickups,
});

const FLOW = ["scheduled", "en_route", "picked_up", "delivered", "completed"] as const;
type Next = "en_route" | "picked_up" | "delivered" | "completed" | "cancelled";

function nextStatus(current: string): Next | null {
  const i = FLOW.indexOf(current as (typeof FLOW)[number]);
  if (i < 0 || i >= FLOW.length - 1) return null;
  return FLOW[i + 1] as Next;
}

function localInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Pickups() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const isNgo = !!me?.roles.includes("ngo");
  const isVolunteer = !!me?.roles.includes("volunteer");
  const isAdmin = !!me?.roles.includes("admin");
  const claims = useQuery({ queryKey: ["myClaims"], queryFn: myClaims });
  const pickups = useQuery({ queryKey: ["pickups"], queryFn: listPickups });
  const offers = useQuery({
    queryKey: ["nearbyDeliveryRequests"],
    queryFn: listNearbyDeliveryRequests,
    enabled: isVolunteer,
    refetchInterval: 10_000,
  });
  const deliveryPins = useQuery({
    queryKey: ["deliveryPins"],
    queryFn: listMyDeliveryPins,
    enabled: isNgo || isAdmin,
  });

  const schedule = useMutation({
    mutationFn: schedulePickup,
    onSuccess: (result) => {
      const created = result as { deliveryPin: string };
      toast.success(`Delivery requested. NGO PIN: ${created.deliveryPin}`);
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const accept = useMutation({
    mutationFn: acceptDeliveryRequest,
    onSuccess: (result) => {
      toast.success("Delivery accepted — it is now assigned to you");
      qc.invalidateQueries();
      navigate({
        to: "/delivery/$pickupId",
        params: { pickupId: result.pickupId },
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const verifyPin = useMutation({
    mutationFn: verifyDeliveryPin,
    onSuccess: () => {
      toast.success("PIN verified — delivery completed");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const advance = useMutation({
    mutationFn: advancePickup,
    onSuccess: () => {
      toast.success("Pickup updated");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const drop = useMutation({
    mutationFn: cancelClaim,
    onSuccess: () => {
      toast.success("Claim released");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const plan = useMutation({
    mutationFn: optimizeRoute,
    onError: (e: Error) => toast.error(e.message),
  });

  const [times, setTimes] = useState<Record<string, string>>({});
  const [pinValues, setPinValues] = useState<Record<string, string>>({});
  const defaultTime = localInput(new Date(Date.now() + 60 * 60 * 1000));

  const unscheduled = (claims.data ?? []).filter(
    (c: Row) => c.status === "confirmed" && !(c.pickups ?? []).length,
  );

  const active = useMemo(
    () =>
      (pickups.data ?? []).filter((p: Row) =>
        ["scheduled", "en_route", "picked_up", "delivered"].includes(p.status),
      ),
    [pickups.data],
  );
  const done = (pickups.data ?? []).filter((p: Row) =>
    ["completed", "cancelled"].includes(p.status),
  );

  const routeStops = active
    .map((p: Row) => p.claims?.food_listings)
    .filter((l: Row) => l && l.latitude != null && l.longitude != null)
    .slice(0, 9)
    .map((l: Row) => ({
      id: l.id as string,
      label: `${l.title} — ${l.pickup_address}`,
      lat: Number(l.latitude),
      lng: Number(l.longitude),
    }));

  function optimise() {
    const lat = me?.profile?.latitude as number | null | undefined;
    const lng = me?.profile?.longitude as number | null | undefined;
    if (lat == null || lng == null) {
      toast.error("Set your organisation location in Profile first");
      return;
    }
    if (!routeStops.length) {
      toast.error("No mapped pickups to route yet");
      return;
    }
    plan.mutate({ data: { origin: { lat, lng }, stops: routeStops } });
  }

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-3xl font-bold">Pickups & routes</h1>
        <p className="mt-1 text-muted-foreground">
          {isVolunteer
            ? "Accept a nearby request, collect the food and use the NGO PIN to complete delivery."
            : "Request collection, track the delivery partner and confirm receipt with your PIN."}
        </p>
      </div>

      {isVolunteer && (
        <section className="grid gap-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Bell className="size-4" /> Nearby delivery requests (
            {offers.data?.requests.length ?? 0})
          </h2>
          {offers.data?.requiresLocation && (
            <div className="surface-panel p-5 text-sm">
              Add your current latitude and longitude in Profile to receive nearby delivery alerts.
            </div>
          )}
          {(offers.data?.requests ?? []).map((request) => (
            <div
              key={request.id}
              className="surface-panel grid gap-3 p-5 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div className="flex items-center gap-3">
                <FoodPhoto
                  src={request.photo_url}
                  alt={`${request.title} food`}
                  className="size-20 shrink-0"
                />
                <div>
                  <p className="font-medium">{request.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {request.quantity} {request.unit} · {request.city} · {request.distance_km} km
                    away
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Requested for {new Date(request.scheduled_time).toLocaleString()}
                  </p>
                </div>
              </div>
              <Button
                disabled={accept.isPending}
                onClick={() => accept.mutate({ data: { pickup_id: request.id } })}
              >
                Accept delivery
              </Button>
            </div>
          ))}
          {!offers.isLoading && !offers.data?.requiresLocation && !offers.data?.requests.length && (
            <p className="text-sm text-muted-foreground">
              No delivery requests inside your service radius right now. This list refreshes
              automatically.
            </p>
          )}
        </section>
      )}

      {(isNgo || isAdmin) && (
        <section className="grid gap-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <CalendarClock className="size-4" /> Awaiting scheduling ({unscheduled.length})
          </h2>
          {unscheduled.map((c: Row) => (
            <div
              key={c.id}
              className="surface-panel grid gap-3 p-5 sm:grid-cols-[1fr_auto] sm:items-end"
            >
              <div className="flex items-center gap-3">
                <FoodPhoto
                  src={c.food_listings?.photo_url}
                  alt={`${c.food_listings?.title ?? "Claimed food"} photo`}
                  className="size-20 shrink-0"
                />
                <div>
                  <p className="font-medium">{c.food_listings?.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {c.claimed_quantity} {c.food_listings?.unit} · {c.food_listings?.pickup_address}
                  </p>
                  {c.food_listings?.best_before && (
                    <div className="mt-2">
                      <UrgencyBadge bestBefore={c.food_listings.best_before} showTime />
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid gap-1">
                  <Label htmlFor={`t-${c.id}`} className="text-xs text-muted-foreground">
                    Pickup time
                  </Label>
                  <Input
                    id={`t-${c.id}`}
                    type="datetime-local"
                    value={times[c.id] ?? defaultTime}
                    onChange={(e) => setTimes((t) => ({ ...t, [c.id]: e.target.value }))}
                  />
                </div>
                <Button
                  disabled={schedule.isPending}
                  onClick={() =>
                    schedule.mutate({
                      data: {
                        claim_id: c.id as string,
                        scheduled_time: new Date(times[c.id] ?? defaultTime).toISOString(),
                      },
                    })
                  }
                >
                  Request delivery
                </Button>
                <Button
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => drop.mutate({ data: { id: c.id as string } })}
                >
                  Release
                </Button>
              </div>
            </div>
          ))}
          {!claims.isLoading && !unscheduled.length && (
            <p className="text-sm text-muted-foreground">Nothing waiting to be scheduled.</p>
          )}
        </section>
      )}

      {(isNgo || isAdmin) && !!deliveryPins.data?.length && (
        <section className="grid gap-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <KeyRound className="size-4" /> Delivery PINs
          </h2>
          {deliveryPins.data.map((verification: Row) => (
            <div
              key={verification.pickup_id}
              className="surface-panel flex flex-wrap items-center justify-between gap-4 p-5"
            >
              <div>
                <div className="flex items-center gap-3">
                  <FoodPhoto
                    src={verification.pickups?.claims?.food_listings?.photo_url}
                    alt={`${verification.pickups?.claims?.food_listings?.title ?? "Food order"} photo`}
                    className="size-16 shrink-0"
                  />
                  <div>
                    <p className="font-medium">
                      {verification.pickups?.claims?.food_listings?.title ?? "Food order"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Share this PIN only after you physically receive the food.
                    </p>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <p className="font-mono text-3xl font-bold tracking-[0.25em]">
                  {verification.pin_code}
                </p>
                <p className="text-xs text-muted-foreground">
                  {verification.verified_at
                    ? "Verified and completed"
                    : `${verification.failed_attempts}/5 failed attempts`}
                </p>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Navigation className="size-4" /> Active pickups ({active.length})
          </h2>
          {(isNgo || isAdmin) && (
            <Button variant="outline" onClick={optimise} disabled={plan.isPending}>
              <RouteIcon className="mr-1 size-4" /> Optimise route
            </Button>
          )}
        </div>

        {plan.data && (
          <div className="surface-panel p-5">
            <p className="text-sm font-semibold">
              Suggested run · {plan.data.totalKm} km · ~{plan.data.totalMinutes} min
            </p>
            <ol className="mt-3 grid gap-2">
              {plan.data.order.map((s, i) => (
                <li key={s.id} className="flex items-start gap-3 text-sm">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                    {i + 1}
                  </span>
                  <span>
                    {s.label}
                    <span className="text-muted-foreground">
                      {" "}
                      · {s.legKm} km, {s.legMinutes} min from previous stop
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {active.map((p: Row) => {
          const listing = p.claims?.food_listings;
          const otherParty = isVolunteer ? p.ngo_profile : p.volunteer_profile;
          const otherPartyLabel = isVolunteer ? "Receiving NGO" : "Delivery partner";
          const next = nextStatus(p.status);
          const allowedNext = isAdmin
            ? next
            : isVolunteer && ["en_route", "picked_up"].includes(next ?? "")
              ? next
              : null;
          return (
            <div
              key={p.id}
              className="surface-panel grid gap-3 p-5 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div className="flex items-start gap-3">
                <FoodPhoto
                  src={listing?.photo_url}
                  alt={`${listing?.title ?? "Pickup food"} photo`}
                  className="size-20 shrink-0"
                />
                <div>
                  <p className="font-medium">{listing?.title ?? "Pickup"}</p>
                  <p className="flex items-center gap-1 text-sm text-muted-foreground">
                    <MapPin className="size-3.5" /> {listing?.pickup_address}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Scheduled {new Date(p.scheduled_time).toLocaleString()} · status{" "}
                    <span className="font-semibold text-foreground">
                      {String(p.status).replace("_", " ")}
                    </span>
                  </p>
                  {p.volunteer_id && (isNgo || isVolunteer || isAdmin) && (
                    <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                      <p className="font-semibold">{otherPartyLabel}</p>
                      {otherParty ? (
                        <div className="mt-1 grid gap-0.5 text-muted-foreground">
                          <p>{otherParty.org_name || otherParty.full_name}</p>
                          {otherParty.phone && <p>Phone: {otherParty.phone}</p>}
                          {otherParty.email && <p>Email: {otherParty.email}</p>}
                          {otherParty.address && (
                            <p>
                              Address: {otherParty.address}
                              {otherParty.city ? `, ${otherParty.city}` : ""}
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="mt-1 text-muted-foreground">Profile details unavailable.</p>
                      )}
                    </div>
                  )}
                </div>
                {isVolunteer && p.status === "picked_up" && (
                  <div className="mt-3 flex max-w-sm gap-2">
                    <Input
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="6-digit NGO PIN"
                      value={pinValues[p.id] ?? ""}
                      onChange={(event) => {
                        const pin = event.target.value.replace(/\D/g, "").slice(0, 6);
                        setPinValues((current) => ({ ...current, [p.id]: pin }));
                      }}
                    />
                    <Button
                      disabled={verifyPin.isPending || (pinValues[p.id]?.length ?? 0) !== 6}
                      onClick={() =>
                        verifyPin.mutate({
                          data: { pickup_id: p.id as string, pin: pinValues[p.id] ?? "" },
                        })
                      }
                    >
                      Verify & complete
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {p.volunteer_id && (isNgo || isVolunteer || isAdmin) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      navigate({
                        to: "/delivery/$pickupId",
                        params: { pickupId: p.id as string },
                      })
                    }
                  >
                    <MapPin className="mr-1 size-4" /> Delivery map
                  </Button>
                )}
                {allowedNext && (
                  <Button
                    size="sm"
                    disabled={advance.isPending}
                    onClick={() =>
                      advance.mutate({ data: { id: p.id as string, status: allowedNext } })
                    }
                  >
                    Mark {allowedNext.replace("_", " ")}
                  </Button>
                )}
                {(isNgo || isAdmin) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() =>
                      advance.mutate({ data: { id: p.id as string, status: "cancelled" } })
                    }
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {!pickups.isLoading && !active.length && (
          <p className="text-sm text-muted-foreground">No pickups in progress.</p>
        )}
      </section>

      {!!done.length && (
        <section className="grid gap-3">
          <h2 className="text-lg font-semibold">History</h2>
          {done.map((p: Row) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm"
            >
              <span className="truncate">{p.claims?.food_listings?.title ?? "Pickup"}</span>
              <span className="text-muted-foreground">{String(p.status)}</span>
            </div>
          ))}
        </section>
      )}

      <FeedbackSection pickups={(pickups.data ?? []) as Row[]} roles={me?.roles ?? []} />
    </div>
  );
}
