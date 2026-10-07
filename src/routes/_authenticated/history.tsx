import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useMe } from "@/hooks/useMe";
import { myListings, myClaims, listPickups, receivedFeedback } from "@/lib/feedforward.functions";
export const Route = createFileRoute("/_authenticated/history")({ component: History });
function History() {
  const { data: me } = useMe();
  const [day, setDay] = useState("");
  const donor = !!me?.roles.includes("donor"),
    ngo = !!me?.roles.includes("ngo");
  const listings = useQuery({ queryKey: ["myListings"], queryFn: myListings, enabled: donor });
  const claims = useQuery({ queryKey: ["myClaims"], queryFn: myClaims, enabled: ngo });
  const pickups = useQuery({ queryKey: ["pickups"], queryFn: listPickups });
  const feedback = useQuery({
    queryKey: ["receivedFeedback"],
    queryFn: receivedFeedback,
    enabled: donor,
  });
  const events = [
    ...(listings.data ?? []).map((x) => ({
      id: x.id,
      type: "Listed",
      date: x.created_at,
      title: x.title,
      status: x.status,
      pickup: null,
    })),
    ...(claims.data ?? []).map((x) => ({
      id: x.id,
      type: "Claimed",
      date: x.created_at,
      title: x.food_listings?.title,
      status: x.status,
      pickup: null,
    })),
    ...(pickups.data ?? []).map((x) => ({
      id: x.id,
      type: x.status === "completed" ? "Delivered" : "Delivery",
      date: x.delivered_time ?? x.updated_at ?? x.created_at,
      title: x.claims?.food_listings?.title,
      status: x.status,
      pickup: String(x.id),
    })),
  ]
    .filter((x) => !day || new Date(x.date).toLocaleDateString("en-CA") === day)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return (
    <div className="grid gap-4">
      <h1 className="text-3xl font-bold">Activity history</h1>
      <label>
        Filter by date{" "}
        <input
          className="rounded border bg-background p-2"
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
        />
      </label>
      {[listings, claims, pickups].some((q) => q.isLoading) && <p>Loading history…</p>}
      {[listings, claims, pickups].map(
        (q, i) =>
          q.error && (
            <p key={i} role="alert">
              {q.error.message}
            </p>
          ),
      )}
      {events.map((x) => (
        <article className="surface-panel p-4" key={`${x.type}-${x.id}`}>
          <h2 className="font-semibold">
            {x.type}: {x.title ?? "Food delivery"}
          </h2>
          <p>
            {new Date(x.date).toLocaleString()} · {x.status}
          </p>
          {x.pickup && !donor && (
            <Link
              className="text-primary underline"
              to="/delivery/$pickupId"
              params={{ pickupId: x.pickup }}
            >
              View order
            </Link>
          )}
        </article>
      ))}
      {!events.length && !pickups.isLoading && <p>No activity for this date.</p>}
      {donor && (
        <section className="grid gap-3">
          <h2 className="text-xl font-semibold">NGO feedback about your food</h2>
          {feedback.error && <p role="alert">{feedback.error.message}</p>}
          {feedback.data?.length === 0 && <p>No food reviews yet.</p>}
          {feedback.data?.map((f) => (
            <article key={f.id} className="surface-panel p-4">
              <p>
                {f.rating}/5 · {new Date(f.created_at).toLocaleString()}
              </p>
              <p>{f.comment}</p>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
