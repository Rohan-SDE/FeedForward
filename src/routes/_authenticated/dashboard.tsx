import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, PackagePlus, Soup, Truck } from "lucide-react";
import { useMe } from "@/hooks/useMe";
import {
  browseListings,
  getImpact,
  listPickups,
  myClaims,
  myListings,
} from "@/lib/feedforward.functions";
import { Button } from "@/components/ui/button";
import { UrgencyBadge } from "@/components/UrgencyBadge";
import { formatNumber, timeLeftLabel } from "@/lib/food";
import type { Row } from "@/lib/rows";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — FeedForward" },
      {
        name: "description",
        content:
          "Your FeedForward control room: active surplus posts, open claims, upcoming pickups and impact so far.",
      },
      { property: "og:title", content: "Dashboard — FeedForward" },
      { property: "og:description", content: "Track surplus posts, claims and pickups." },
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

function Dashboard() {
  const { data: me } = useMe();
  const isDonor = !!me?.roles.includes("donor");

  const mine = useQuery({ queryKey: ["myListings"], queryFn: useServerFn(myListings) });
  const claims = useQuery({ queryKey: ["myClaims"], queryFn: useServerFn(myClaims) });
  const open = useQuery({ queryKey: ["browse"], queryFn: useServerFn(browseListings) });
  const pickups = useQuery({ queryKey: ["pickups"], queryFn: useServerFn(listPickups) });
  const impact = useQuery({ queryKey: ["impact"], queryFn: useServerFn(getImpact) });

  const meals = (impact.data?.records ?? []).reduce(
    (s: number, r: Row) => s + Number(r.meals_saved ?? 0),
    0,
  );
  const activeMine = (mine.data ?? []).filter((l: Row) =>
    ["posted", "claimed", "scheduled"].includes(l.status),
  );
  const upcoming = (pickups.data ?? []).filter((p: Row) =>
    ["scheduled", "en_route", "picked_up"].includes(p.status),
  );

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">
            Hello{me?.profile?.full_name ? `, ${me.profile.full_name.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {isDonor
              ? "Post what's left over today and let nearby NGOs collect it."
              : "Claim nearby surplus food and schedule pickups before the safe window closes."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link to="/donate">
              <PackagePlus className="mr-1 size-4" /> Post surplus
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/listings">
              <Soup className="mr-1 size-4" /> Browse food
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Meals saved" value={formatNumber(meals)} hint="Across completed pickups" />
        <Stat label="Open donations nearby" value={String(open.data?.length ?? 0)} />
        <Stat label="My active posts" value={String(activeMine.length)} />
        <Stat label="Upcoming pickups" value={String(upcoming.length)} />
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="surface-panel p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <PackagePlus className="size-4" /> My recent posts
          </h2>
          <div className="mt-4 grid gap-3">
            {(mine.data ?? []).slice(0, 5).map((l: Row) => (
              <div
                key={l.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{l.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {l.quantity} {l.unit} · {timeLeftLabel(l.best_before)}
                  </p>
                </div>
                <UrgencyBadge bestBefore={l.best_before} status={l.status} />
              </div>
            ))}
            {!mine.isLoading && !(mine.data ?? []).length && (
              <p className="text-sm text-muted-foreground">
                Nothing posted yet.{" "}
                <Link to="/donate" className="font-medium text-primary underline">
                  Post your first surplus
                </Link>
                .
              </p>
            )}
          </div>
        </div>

        <div className="surface-panel p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <CalendarClock className="size-4" /> My claims
          </h2>
          <div className="mt-4 grid gap-3">
            {(claims.data ?? []).slice(0, 5).map((c: Row) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.food_listings?.title ?? "Listing"}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.claimed_quantity} {c.food_listings?.unit} · {c.status.replace("_", " ")}
                  </p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to="/pickups">
                    <Truck className="mr-1 size-3" /> Manage
                  </Link>
                </Button>
              </div>
            ))}
            {!claims.isLoading && !(claims.data ?? []).length && (
              <p className="text-sm text-muted-foreground">
                No claims yet.{" "}
                <Link to="/listings" className="font-medium text-primary underline">
                  Find food nearby
                </Link>
                .
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
