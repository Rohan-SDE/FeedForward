import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Clock, Leaf, MapPin, Route as RouteIcon, ShieldCheck } from "lucide-react";
import { RescueScene } from "@/components/RescueScene";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FeedForward — Rescue surplus food, feed your city" },
      {
        name: "description",
        content:
          "FeedForward links restaurants, canteens and event caterers with nearby NGOs and shelters: post surplus food, claim it, schedule pickups and measure the impact.",
      },
      { property: "og:title", content: "FeedForward — Rescue surplus food, feed your city" },
      {
        property: "og:description",
        content:
          "Post surplus food, get matched with nearby NGOs, schedule pickups and track meals saved.",
      },
    ],
    links: [{ rel: "canonical", href: "https://meal-link-loop.lovable.app/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "FeedForward",
          url: "https://meal-link-loop.lovable.app",
          description:
            "A surplus food rescue network where donors post leftover food and nearby NGOs claim it, schedule pickups and track meals saved and CO2 avoided.",
        }),
      },
    ],
  }),

  component: Landing,
});

const features = [
  {
    icon: MapPin,
    title: "Location-matched alerts",
    body: "NGOs set a service radius and food preferences, then see every nearby donation sorted by distance and expiry urgency.",
  },
  {
    icon: Clock,
    title: "Freshness first",
    body: "Preparation and best-before times help prioritise collections. Donors remain responsible for safe storage and accurate food information.",
  },
  {
    icon: RouteIcon,
    title: "Optimised pickup routes",
    body: "Multiple pickups scheduled? Stops are ordered using approximate distances, with navigation links for your journey.",
  },
  {
    icon: ShieldCheck,
    title: "Verified organisations",
    body: "Admins can review donors and NGOs and mark verified organisations, helping you make informed collection decisions.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <span className="flex items-center gap-2 font-display text-lg font-bold">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Leaf className="size-4" />
          </span>
          FeedForward
        </span>
        <Button asChild variant="ghost">
          <Link to="/auth">Sign in</Link>
        </Button>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-10 lg:grid-cols-2 lg:py-20">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs font-semibold uppercase tracking-wide text-secondary-foreground">
            Food waste → meals
          </span>
          <h1 className="mt-5 text-4xl font-extrabold leading-[1.05] sm:text-5xl lg:text-6xl">
            Surplus food, <span className="text-gradient-harvest">rescued in hours</span> — not
            thrown away.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted-foreground">
            Restaurants, hostels and canteens post what's left over. Nearby NGOs and shelters claim
            it, schedule a pickup, and every completed run is counted as meals served and CO₂
            avoided.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/auth">
                Get started <ArrowRight className="ml-1 size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/auth">I'm an NGO looking for food</Link>
            </Button>
          </div>
        </div>

        <RescueScene />
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="text-2xl font-bold sm:text-3xl">Built for the whole chain</h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Donors, NGOs, volunteers and platform admins each get the view they need — on phones and
          low-bandwidth connections included.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {features.map((f) => (
            <div key={f.title} className="surface-panel p-6">
              <span className="grid size-10 place-items-center rounded-xl bg-secondary text-secondary-foreground">
                <f.icon className="size-5" />
              </span>
              <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="bg-harvest rounded-3xl px-6 py-12 text-center text-primary-foreground sm:px-12">
          <h2 className="text-2xl font-bold sm:text-3xl">Every tray counted. Every meal traced.</h2>
          <p className="mx-auto mt-3 max-w-xl text-primary-foreground/85">
            Impact dashboards and downloadable reports make CSR and grant reporting a two-click job.
          </p>
          <Button asChild size="lg" variant="secondary" className="mt-7">
            <Link to="/auth">Join FeedForward</Link>
          </Button>
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        FeedForward — rescuing surplus food, one pickup at a time.
      </footer>
    </div>
  );
}
