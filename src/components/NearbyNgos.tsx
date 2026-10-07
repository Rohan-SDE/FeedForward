import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { useMe } from "@/hooks/useMe";
import { listNearbyNgos } from "@/lib/feedforward.functions";
import { Button } from "@/components/ui/button";
export default function NearbyNgos() {
  const { data: me } = useMe();
  const query = useQuery({
    queryKey: [
      "nearbyNgos",
      me?.userId,
      me?.profile?.latitude,
      me?.profile?.longitude,
      me?.profile?.service_radius_km,
    ],
    queryFn: listNearbyNgos,
    enabled: !!me?.roles.some((role) => role === "donor" || role === "admin"),
  });
  return (
    <section className="surface-panel p-6" aria-labelledby="nearby-ngos-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="nearby-ngos-heading" className="flex items-center gap-2 text-lg font-semibold">
            <MapPin className="size-4" /> Nearby NGOs
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Registered NGOs near your saved location
            {query.data?.radiusKm ? `, within ${query.data.radiusKm} km` : ""}. Distances are
            approximate straight-line distances.
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to="/profile">Update location</Link>
        </Button>
      </div>
      {query.isLoading && (
        <p className="mt-4 text-sm" role="status">
          Finding nearby NGOs…
        </p>
      )}
      {query.isError && (
        <div className="mt-4" role="alert">
          <p className="text-sm">{query.error.message}</p>
          <Button className="mt-2" size="sm" variant="outline" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {query.data?.requiresLocation && (
        <p className="mt-4 text-sm">Save your location in Profile to find nearby NGOs.</p>
      )}
      {query.data && !query.data.requiresLocation && !query.data.ngos.length && (
        <p className="mt-4 text-sm text-muted-foreground">
          No registered NGOs with a saved location were found within your search radius. You can
          change the radius in Profile.
        </p>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {query.data?.ngos.map((ngo) => (
          <article key={ngo.id} className="rounded-xl border border-border p-4">
            <h3 className="font-semibold">{ngo.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {ngo.city || "City not provided"} · {ngo.distanceKm.toFixed(1)} km away
            </p>
            <p className="mt-2 text-xs">{ngo.verified ? "Verified NGO" : "Not yet verified"}</p>
          </article>
        ))}
      </div>
      {query.data?.searchLimited && (
        <p className="mt-3 text-xs text-muted-foreground">
          Showing a limited set of registered NGOs.
        </p>
      )}
    </section>
  );
}
