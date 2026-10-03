import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Leaf, Scale, Soup, Users } from "lucide-react";
import { getImpact } from "@/lib/feedforward.functions";
import type { Row } from "@/lib/rows";
import { formatNumber } from "@/lib/food";

export const Route = createFileRoute("/_authenticated/impact")({
  head: () => ({
    meta: [
      { title: "Impact dashboard — FeedForward" },
      {
        name: "description",
        content:
          "Meals saved, food weight rescued and CO2 emissions avoided across every completed FeedForward pickup.",
      },
      { property: "og:title", content: "Impact dashboard — FeedForward" },
      {
        property: "og:description",
        content: "Track meals saved, kilograms rescued and CO2 avoided.",
      },
    ],
  }),
  component: Impact,
});

function Impact() {
  const impact = useQuery({ queryKey: ["impact"], queryFn: getImpact });
  const records = (impact.data?.records ?? []) as Row[];

  const meals = records.reduce((s, r) => s + Number(r.meals_saved ?? 0), 0);
  const weight = records.reduce((s, r) => s + Number(r.weight_kg ?? 0), 0);
  const co2 = records.reduce((s, r) => s + Number(r.co2_avoided_kg ?? 0), 0);

  const byType = new Map<string, number>();
  records.forEach((r) =>
    byType.set(
      r.food_type ?? "Other",
      (byType.get(r.food_type ?? "Other") ?? 0) + Number(r.meals_saved ?? 0),
    ),
  );
  const maxType = Math.max(1, ...byType.values());

  const stats = [
    { icon: Soup, label: "Meals saved", value: formatNumber(meals) },
    { icon: Scale, label: "Food rescued (kg)", value: formatNumber(weight) },
    { icon: Leaf, label: "CO₂ avoided (kg)", value: formatNumber(co2) },
    { icon: Users, label: "Completed pickups", value: formatNumber(records.length) },
  ];

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-3xl font-bold">Impact</h1>
        <p className="mt-1 text-muted-foreground">
          Every completed pickup is converted into meals, weight and avoided emissions.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="surface-panel p-5">
            <span className="grid size-10 place-items-center rounded-xl bg-secondary text-secondary-foreground">
              <s.icon className="size-5" />
            </span>
            <p className="mt-4 text-3xl font-bold">{s.value}</p>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {s.label}
            </p>
          </div>
        ))}
      </div>

      <section className="surface-panel p-6">
        <h2 className="text-lg font-semibold">Meals saved by food type</h2>
        <div className="mt-4 grid gap-3">
          {[...byType.entries()].map(([type, value]) => (
            <div key={type}>
              <div className="flex justify-between text-sm">
                <span>{type}</span>
                <span className="font-semibold">{formatNumber(value)}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="bg-harvest h-full rounded-full"
                  style={{ width: `${(value / maxType) * 100}%` }}
                />
              </div>
            </div>
          ))}
          {!byType.size && (
            <p className="text-sm text-muted-foreground">
              No completed pickups yet — impact appears once a pickup is marked completed.
            </p>
          )}
        </div>
      </section>

      <section className="surface-panel p-6">
        <h2 className="text-lg font-semibold">Recent rescues</h2>
        <div className="mt-4 grid gap-2">
          {records
            .slice()
            .reverse()
            .slice(0, 12)
            .map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-4 py-3 text-sm"
              >
                <span className="font-medium">{r.food_type ?? "Food"}</span>
                <span className="text-muted-foreground">
                  {formatNumber(Number(r.meals_saved ?? 0))} meals ·{" "}
                  {formatNumber(Number(r.weight_kg ?? 0))} kg ·{" "}
                  {formatNumber(Number(r.co2_avoided_kg ?? 0))} kg CO₂
                </span>
                <span className="text-xs text-muted-foreground">
                  {r.completed_at ? new Date(r.completed_at).toLocaleDateString() : ""}
                </span>
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}
