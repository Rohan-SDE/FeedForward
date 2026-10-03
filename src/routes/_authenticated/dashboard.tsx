import NearbyNgos from "@/components/NearbyNgos";
import { toast } from "sonner";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, MapPin, PackagePlus, Soup, Truck } from "lucide-react";
import { useMe } from "@/hooks/useMe";
import {
  acceptDeliveryRequest,
  browseListings,
  getImpact,
  listNearbyDeliveryRequests,
  listPickups,
  myClaims,
  myListings,
} from "@/lib/feedforward.functions";
import { Button } from "@/components/ui/button";
import { UrgencyBadge } from "@/components/UrgencyBadge";
import FoodPhoto from "@/components/FoodPhoto";
import { formatNumber, timeLeftLabel } from "@/lib/food";
import type { Row } from "@/lib/rows";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — FeedForward" },
      {
        name: "description",
        content: "A role-specific FeedForward workspace for donors, NGOs and volunteers.",
      },
    ],
  }),
  component: Dashboard,
});

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="surface-panel p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function PageHeading({
  eyebrow,
  name,
  description,
  action,
}: {
  eyebrow: string;
  name: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{eyebrow}</p>
        <h1 className="mt-1 text-3xl font-bold">Hello{name ? `, ${name}` : ""}</h1>
        <p className="mt-1 text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

function DonorDashboard({
  name,
  listings,
  pickups,
  meals,
}: {
  name: string;
  listings: Row[];
  pickups: Row[];
  meals: number;
}) {
  const active = listings.filter((item) =>
    ["posted", "claimed", "scheduled"].includes(String(item.status)),
  );
  const claimed = listings.filter((item) => Number(item.claimed_quantity ?? 0) > 0);
  const upcoming = pickups.filter((item) =>
    ["scheduled", "en_route", "picked_up"].includes(String(item.status)),
  );

  return (
    <div className="grid gap-8">
      <PageHeading
        eyebrow="Donor workspace"
        name={name}
        description="Publish today's surplus and track it until a rescue is completed."
        action={
          <Button asChild>
            <Link to="/donate">
              <PackagePlus className="mr-1 size-4" /> Post surplus
            </Link>
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active posts" value={String(active.length)} />
        <Stat label="Posts with claims" value={String(claimed.length)} />
        <Stat label="Upcoming pickups" value={String(upcoming.length)} />
        <Stat label="Meals saved" value={formatNumber(meals)} />
      </div>
      <NearbyNgos />
      <section className="surface-panel p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Soup className="size-4" /> My recent donations
          </h2>
          <Button asChild size="sm" variant="outline">
            <Link to="/donate">Manage posts</Link>
          </Button>
        </div>
        <div className="mt-4 grid gap-3">
          {listings.slice(0, 6).map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3"
            >
              <FoodPhoto
                src={item.photo_url}
                alt={`${item.title} food`}
                className="size-14 shrink-0"
              />
              <div className="min-w-0">
                <p className="truncate font-medium">{item.title}</p>
                <p className="text-xs text-muted-foreground">
                  {item.quantity} {item.unit} · {item.claimed_quantity ?? 0} claimed ·{" "}
                  {timeLeftLabel(item.best_before)}
                </p>
              </div>
              <UrgencyBadge bestBefore={item.best_before} status={item.status} />
            </div>
          ))}
          {!listings.length && (
            <p className="text-sm text-muted-foreground">Post your first surplus donation.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function NgoDashboard({
  name,
  listings,
  claims,
  pickups,
  meals,
}: {
  name: string;
  listings: Row[];
  claims: Row[];
  pickups: Row[];
  meals: number;
}) {
  const claimable = listings.filter(
    (item) => Number(item.quantity) - Number(item.claimed_quantity ?? 0) > 0,
  );
  const activeClaims = claims.filter((item) =>
    ["confirmed", "scheduled", "picked_up", "delivered"].includes(String(item.status)),
  );
  const upcoming = pickups.filter((item) =>
    ["scheduled", "en_route", "picked_up"].includes(String(item.status)),
  );

  return (
    <div className="grid gap-8">
      <PageHeading
        eyebrow="NGO workspace"
        name={name}
        description="Find safe surplus nearby, claim it and coordinate collection."
        action={
          <Button asChild>
            <Link to="/listings">
              <MapPin className="mr-1 size-4" /> Find nearby food
            </Link>
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Food available" value={String(claimable.length)} />
        <Stat label="My active claims" value={String(activeClaims.length)} />
        <Stat label="Upcoming pickups" value={String(upcoming.length)} />
        <Stat label="Community meals saved" value={formatNumber(meals)} />
      </div>
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="surface-panel p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Soup className="size-4" /> Urgent nearby food
          </h2>
          <div className="mt-4 grid gap-3">
            {claimable.slice(0, 4).map((item) => (
              <div key={item.id} className="rounded-xl border border-border px-4 py-3">
                <div className="flex items-start gap-3">
                  <FoodPhoto
                    src={item.photo_url}
                    alt={`${item.title} food`}
                    className="size-16 shrink-0"
                  />
                  <div>
                    <p className="font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {Number(item.quantity) - Number(item.claimed_quantity ?? 0)} {item.unit} ·{" "}
                      {item.city ?? "Approximate area"}
                    </p>
                  </div>
                  <div className="ml-auto">
                    <UrgencyBadge bestBefore={item.best_before} showTime />
                    <Button asChild size="sm" className="mt-2">
                      <Link to="/listings" search={{ listing: String(item.id) }}>
                        View &amp; claim
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            {!claimable.length && (
              <p className="text-sm text-muted-foreground">No claimable food nearby right now.</p>
            )}
          </div>
        </div>
        <div className="surface-panel p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <CalendarClock className="size-4" /> My latest claims
          </h2>
          <div className="mt-4 grid gap-3">
            {claims.slice(0, 4).map((claim) => (
              <div
                key={claim.id}
                className="flex items-center gap-3 rounded-xl border border-border px-4 py-3"
              >
                <FoodPhoto
                  src={claim.food_listings?.photo_url}
                  alt={`${claim.food_listings?.title ?? "Claimed food"} photo`}
                  className="size-16 shrink-0"
                />
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {claim.food_listings?.title ?? "Food claim"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {claim.claimed_quantity} {claim.food_listings?.unit} ·{" "}
                    {String(claim.status).replaceAll("_", " ")}
                  </p>
                </div>
              </div>
            ))}
            {!claims.length && <p className="text-sm text-muted-foreground">No claims yet.</p>}
          </div>
        </div>
      </section>
    </div>
  );
}

function VolunteerDashboard({
  name,
  pickups,
  meals,
  offers,
  offersLoading,
  offersError,
  requiresLocation,
}: {
  name: string;
  pickups: Row[];
  meals: number;
  offers: Row[];
  offersLoading: boolean;
  offersError: string | null;
  requiresLocation: boolean;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const accept = useMutation({
    mutationFn: acceptDeliveryRequest,
    onSuccess: (result) => {
      toast.success("Delivery accepted — opening navigation and location sharing");
      void qc.invalidateQueries({ queryKey: ["pickups"] });
      void qc.invalidateQueries({ queryKey: ["nearbyDeliveryRequests"] });
      void navigate({ to: "/delivery/$pickupId", params: { pickupId: result.pickupId } });
    },
    onError: (error: Error) => {
      toast.error(error.message);
      void qc.invalidateQueries({ queryKey: ["nearbyDeliveryRequests"] });
    },
  });
  const active = pickups.filter((item) =>
    ["scheduled", "en_route", "picked_up", "delivered"].includes(String(item.status)),
  );
  const completed = pickups.filter((item) => item.status === "completed");
  const next = active[0];

  return (
    <div className="grid gap-8">
      <PageHeading
        eyebrow="Volunteer workspace"
        name={name}
        description="Accept nearby food-rescue requests and complete delivery with the NGO PIN."
        action={
          <Button asChild>
            <Link to="/pickups">
              <Truck className="mr-1 size-4" /> Open my deliveries
            </Link>
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Nearby requests" value={String(offers.length)} />
        <Stat label="Active assignments" value={String(active.length)} />
        <Stat label="Completed deliveries" value={String(completed.length)} />
        <Stat label="Community meals saved" value={formatNumber(meals)} />
      </div>
      {requiresLocation && (
        <div className="surface-panel flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm">Add your location to start receiving nearby delivery requests.</p>
          <Button asChild size="sm" variant="outline">
            <Link to="/profile">Set my location</Link>
          </Button>
        </div>
      )}
      <section className="grid gap-4">
        <h2 className="text-lg font-semibold">Nearby delivery requests</h2>
        {offersLoading && <p className="text-sm text-muted-foreground">Loading nearby requests…</p>}
        {offersError && (
          <p role="alert" className="text-sm text-destructive">
            {offersError}
          </p>
        )}
        {!offersLoading && !offersError && !requiresLocation && offers.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No nearby requests right now. Updates refresh automatically.
          </p>
        )}
        {active.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Complete your active delivery before accepting another.
          </p>
        )}
        {offers.map((request) => (
          <article
            key={request.id}
            className="surface-panel flex flex-wrap items-center justify-between gap-4 p-5"
          >
            <div className="flex items-center gap-3">
              <FoodPhoto
                src={request.photo_url}
                alt={`${request.title} food`}
                className="size-20 shrink-0"
              />
              <div>
                <h3 className="font-medium">{request.title}</h3>
                <p className="text-sm text-muted-foreground">
                  {request.quantity} {request.unit} · {request.city} · {request.distance_km} km away
                </p>
                <p className="text-xs text-muted-foreground">
                  Requested for {new Date(request.scheduled_time).toLocaleString()}
                </p>
              </div>
            </div>
            <Button
              disabled={accept.isPending || active.length > 0}
              onClick={() => accept.mutate({ data: { pickup_id: String(request.id) } })}
            >
              {accept.isPending && accept.variables?.data.pickup_id === request.id
                ? "Accepting…"
                : "Accept & share location"}
            </Button>
          </article>
        ))}
      </section>
      <section className="surface-panel p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Truck className="size-4" /> Next assignment
        </h2>
        {next ? (
          <div className="mt-4 rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">{next.claims?.food_listings?.title ?? "Food pickup"}</p>
                <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin className="size-3.5" />
                  {next.claims?.food_listings?.pickup_address ?? "Pickup address unavailable"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(next.scheduled_time).toLocaleString()} ·{" "}
                  {String(next.status).replaceAll("_", " ")}
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to="/delivery/$pickupId" params={{ pickupId: String(next.id) }}>
                  Open navigation
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4" /> No active delivery assigned.
          </p>
        )}
      </section>
    </div>
  );
}

function Dashboard() {
  const { data: me, isLoading } = useMe();
  const isDonor = !!me?.roles.includes("donor");
  const isNgo = !!me?.roles.includes("ngo");
  const isVolunteer = !!me?.roles.includes("volunteer");
  const isAdmin = !!me?.roles.includes("admin");

  const mine = useQuery({
    queryKey: ["myListings"],
    queryFn: myListings,
    enabled: isDonor || isAdmin,
  });
  const claims = useQuery({
    queryKey: ["myClaims"],
    queryFn: myClaims,
    enabled: isNgo,
  });
  const open = useQuery({
    queryKey: ["browse"],
    queryFn: browseListings,
    enabled: isNgo || isAdmin,
    refetchInterval: 10_000,
  });
  const pickups = useQuery({
    queryKey: ["pickups"],
    queryFn: listPickups,
    refetchInterval: 10_000,
    enabled: !!me?.roles.length,
  });
  const deliveryOffers = useQuery({
    queryKey: ["nearbyDeliveryRequests"],
    queryFn: listNearbyDeliveryRequests,
    enabled: isVolunteer,
    refetchInterval: 10_000,
  });
  const impact = useQuery({
    queryKey: ["impact"],
    queryFn: getImpact,
    enabled: !!me,
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading your workspace…</p>;
  }

  if (me && !me.roles.length) {
    return (
      <div className="surface-panel mx-auto max-w-xl p-8 text-center">
        <h1 className="text-2xl font-bold">Finish account setup</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose your donor, NGO, or volunteer role before using FeedForward.
        </p>
        <Button asChild className="mt-5">
          <Link to="/profile">Choose account role</Link>
        </Button>
      </div>
    );
  }

  const firstName = String(me?.profile?.full_name ?? "").split(" ")[0] ?? "";
  const pickupRows = (pickups.data ?? []) as Row[];
  const meals = ((impact.data?.records ?? []) as Row[]).reduce(
    (total, record) => total + Number(record.meals_saved ?? 0),
    0,
  );

  if (isVolunteer) {
    return (
      <VolunteerDashboard
        name={firstName}
        pickups={pickupRows}
        meals={meals}
        offers={deliveryOffers.data?.requests ?? []}
        offersLoading={deliveryOffers.isLoading}
        offersError={deliveryOffers.error?.message ?? null}
        requiresLocation={deliveryOffers.data?.requiresLocation ?? false}
      />
    );
  }
  if (isNgo) {
    return (
      <NgoDashboard
        name={firstName}
        listings={(open.data ?? []) as Row[]}
        claims={(claims.data ?? []) as Row[]}
        pickups={pickupRows}
        meals={meals}
      />
    );
  }
  return (
    <DonorDashboard
      name={firstName}
      listings={(mine.data ?? []) as Row[]}
      pickups={pickupRows}
      meals={meals}
    />
  );
}
