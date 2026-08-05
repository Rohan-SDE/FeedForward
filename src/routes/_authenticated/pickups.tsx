import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, MapPin, Navigation, Route as RouteIcon } from "lucide-react";
import {
  advancePickup,
  cancelClaim,
  listPickups,
  myClaims,
  optimizeRoute,
  schedulePickup,
} from "@/lib/feedforward.functions";
import { useMe } from "@/hooks/useMe";
import type { Row } from "@/lib/rows";
import { UrgencyBadge } from "@/components/UrgencyBadge";
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
  const { data: me } = useMe();
  const claims = useQuery({ queryKey: ["myClaims"], queryFn: useServerFn(myClaims) });
  const pickups = useQuery({ queryKey: ["pickups"], queryFn: useServerFn(listPickups) });

  const schedule = useMutation({
    mutationFn: useServerFn(schedulePickup),
    onSuccess: () => {
      toast.success("Pickup scheduled");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const advance = useMutation({
    mutationFn: useServerFn(advancePickup),
    onSuccess: () => {
      toast.success("Pickup updated");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const drop = useMutation({
    mutationFn: useServerFn(cancelClaim),
    onSuccess: () => {
      toast.success("Claim released");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const plan = useMutation({
    mutationFn: useServerFn(optimizeRoute),
    onError: (e: Error) => toast.error(e.message),
  });

  const [times, setTimes] = useState<Record<string, string>>({});
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
          Schedule collections, move them through the flow, and plan the shortest run.
        </p>
      </div>

      <section className="grid gap-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <CalendarClock className="size-4" /> Awaiting scheduling ({unscheduled.length})
        </h2>
        {unscheduled.map((c: Row) => (
          <div
            key={c.id}
            className="surface-panel grid gap-3 p-5 sm:grid-cols-[1fr_auto] sm:items-end"
          >
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
                Schedule
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

      <section className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Navigation className="size-4" /> Active pickups ({active.length})
          </h2>
          <Button variant="outline" onClick={optimise} disabled={plan.isPending}>
            <RouteIcon className="mr-1 size-4" /> Optimise route
          </Button>
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
          const next = nextStatus(p.status);
          return (
            <div
              key={p.id}
              className="surface-panel grid gap-3 p-5 sm:grid-cols-[1fr_auto] sm:items-center"
            >
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
              </div>
              <div className="flex flex-wrap gap-2">
                {next && (
                  <Button
                    size="sm"
                    disabled={advance.isPending}
                    onClick={() => advance.mutate({ data: { id: p.id as string, status: next } })}
                  >
                    Mark {next.replace("_", " ")}
                  </Button>
                )}
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
    </div>
  );
}
