import { RiderSharing, DeliveryTracking } from "@/components/RiderLive";
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Mail,
  MapPin,
  Navigation,
  PackageCheck,
  Phone,
  Truck,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import NearbyMap, { type MapMarker } from "@/components/NearbyMap";
import FoodPhoto from "@/components/FoodPhoto";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMe } from "@/hooks/useMe";
import {
  advancePickup,
  getDeliveryDetails,
  verifyDeliveryPin,
  reportDeliveryDelay,
} from "@/lib/feedforward.functions";
import type { Row } from "@/lib/rows";

export const Route = createFileRoute("/_authenticated/delivery/$pickupId")({
  head: () => ({
    meta: [
      { title: "Delivery navigation — FeedForward" },
      {
        name: "description",
        content: "Collect the food, navigate to the receiving NGO and verify delivery by PIN.",
      },
    ],
  }),
  component: DeliveryNavigation,
});

function validCoordinates(profile: Row | null | undefined) {
  return (
    profile &&
    profile.latitude != null &&
    profile.longitude != null &&
    Number.isFinite(Number(profile.latitude)) &&
    Number.isFinite(Number(profile.longitude))
  );
}

function directionsUrl(profile: Row | null | undefined) {
  if (!validCoordinates(profile)) return null;
  const destination = `${Number(profile?.latitude)},${Number(profile?.longitude)}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving&dir_action=navigate`;
}

function ContactCard({ title, profile }: { title: string; profile: Row | null }) {
  return (
    <section className="surface-panel p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <UserRound className="size-4" /> {title}
      </h2>
      {profile ? (
        <div className="mt-3 grid gap-2 text-sm">
          <p className="font-medium">{profile.org_name || profile.full_name}</p>
          {profile.org_name && profile.full_name && (
            <p className="text-muted-foreground">Contact: {profile.full_name}</p>
          )}
          {profile.phone && (
            <a
              className="flex items-center gap-2 text-primary hover:underline"
              href={`tel:${profile.phone}`}
            >
              <Phone className="size-4" /> {profile.phone}
            </a>
          )}
          {profile.email && (
            <a
              className="flex items-center gap-2 text-primary hover:underline"
              href={`mailto:${profile.email}`}
            >
              <Mail className="size-4" /> {profile.email}
            </a>
          )}
          <p className="flex items-start gap-2 text-muted-foreground">
            <MapPin className="mt-0.5 size-4 shrink-0" />
            {[profile.address, profile.city].filter(Boolean).join(", ") || "Address unavailable"}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          Waiting for assignment or profile details.
        </p>
      )}
    </section>
  );
}

function DeliveryNavigation() {
  const { pickupId } = Route.useParams();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const [pin, setPin] = useState("");
  const [delayNote, setDelayNote] = useState("");
  const isVolunteer = !!me?.roles.includes("volunteer");

  const details = useQuery({
    queryKey: ["deliveryDetails", pickupId],
    queryFn: () => getDeliveryDetails(pickupId),
    refetchInterval: 10000,
  });

  const refreshDelivery = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["deliveryDetails", pickupId] }),
      queryClient.invalidateQueries({ queryKey: ["pickups"] }),
      queryClient.invalidateQueries({ queryKey: ["deliveryPins"] }),
    ]);
  };

  const advance = useMutation({
    mutationFn: advancePickup,
    onSuccess: async (_, variables) => {
      const status = String(variables.data.status).replaceAll("_", " ");
      toast.success(`Delivery updated: ${status}`);
      await refreshDelivery();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const delay = useMutation({
    mutationFn: reportDeliveryDelay,
    onSuccess: () => {
      toast.success("Delivery update shared");
      setDelayNote("");
      refreshDelivery();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const verifyPin = useMutation({
    mutationFn: verifyDeliveryPin,
    onSuccess: async () => {
      setPin("");
      toast.success("PIN verified — delivery completed");
      await refreshDelivery();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (details.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading delivery details…</p>;
  }
  if (details.isError || !details.data) {
    return (
      <div className="surface-panel p-6">
        <p className="font-semibold">Delivery details could not be loaded</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {details.error instanceof Error ? details.error.message : "Please try again."}
        </p>
        <Button className="mt-4" variant="outline" onClick={() => window.history.back()}>
          <ArrowLeft className="mr-1 size-4" /> Back to pickups
        </Button>
      </div>
    );
  }

  const { pickup, ngo, volunteer } = details.data;
  const listing = pickup.claims?.food_listings as Row | undefined;
  const status = String(pickup.status);
  const ngoMapped = validCoordinates(ngo);
  const listingMapped = validCoordinates(listing);
  const center = ngoMapped
    ? { lat: Number(ngo?.latitude), lng: Number(ngo?.longitude) }
    : listingMapped
      ? { lat: Number(listing?.latitude), lng: Number(listing?.longitude) }
      : null;
  const markers: MapMarker[] = [];

  if (ngoMapped) {
    markers.push({
      id: "ngo",
      lat: Number(ngo?.latitude),
      lng: Number(ngo?.longitude),
      title: `NGO destination: ${ngo?.org_name || ngo?.full_name}`,
      urgency: "fresh",
    });
  }
  if (listingMapped) {
    markers.push({
      id: "donor",
      lat: Number(listing?.latitude),
      lng: Number(listing?.longitude),
      title: `Food pickup: ${listing?.title}`,
      urgency: "soon",
    });
  }

  const donorNavigationUrl = directionsUrl(listing);
  const ngoNavigationUrl = directionsUrl(ngo);
  const travellingToDonor = status === "scheduled" || status === "en_route";
  const activeNavigationUrl = travellingToDonor ? donorNavigationUrl : ngoNavigationUrl;
  const activeDestination = travellingToDonor ? "food donor" : "receiving NGO";
  const completed = status === "completed";
  const cancelled = status === "cancelled";

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Order tracking
          </p>
          <h1 className="mt-1 text-3xl font-bold">
            {completed
              ? "Delivery completed"
              : cancelled
                ? "Delivery cancelled"
                : isVolunteer
                  ? `Navigate to the ${activeDestination}`
                  : "Track your food order"}
          </h1>
          <p className="mt-1 text-muted-foreground">
            Preparation, rider assignment and delivery updates refresh every 10 seconds.
          </p>
        </div>
        {activeNavigationUrl && !completed && !cancelled && (
          <Button asChild>
            <a href={activeNavigationUrl} target="_blank" rel="noreferrer">
              <Navigation className="mr-1 size-4" /> Navigate to{" "}
              {travellingToDonor ? "donor" : "NGO"}
            </a>
          </Button>
        )}
      </div>

      <section className="surface-panel flex items-center gap-4 p-5">
        <FoodPhoto
          src={listing?.photo_url}
          alt={`${listing?.title ?? "Delivery food"} photo`}
          className="size-24 shrink-0"
        />
        <div>
          <h2 className="text-lg font-semibold">{listing?.title ?? "Food delivery"}</h2>
          <p className="text-sm text-muted-foreground">
            {pickup.claims?.claimed_quantity} {listing?.unit} · status {status.replaceAll("_", " ")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Food pickup: {listing?.pickup_address || "Address unavailable"}
          </p>
        </div>
      </section>

      <section className="surface-panel p-5" aria-live="polite">
        <h2 className="font-semibold">Order progress</h2>
        <ol className="mt-3 grid gap-3 text-sm">
          <li>✓ Food claimed</li>
          <li>
            Restaurant:{" "}
            {
              (
                {
                  preparing: "Preparing order",
                  ready: "Order ready for pickup",
                  delayed: "Preparation delayed",
                } as Record<string, string>
              )[String(listing?.preparation_status ?? "preparing")]
            }
            {listing?.preparation_updated_at && (
              <span className="ml-2 text-muted-foreground">
                Updated {new Date(listing.preparation_updated_at).toLocaleTimeString()}
              </span>
            )}
          </li>
          <li>
            {pickup.volunteer_id
              ? `Rider assigned: ${volunteer?.full_name || "Delivery partner"}`
              : "Finding an available nearby rider"}
          </li>
          <li className="font-medium">
            {(
              {
                scheduled: pickup.volunteer_id
                  ? "Rider assigned — awaiting departure"
                  : "Waiting for rider assignment",
                en_route: "Rider is on the way to the restaurant",
                picked_up: "Food picked up — on the way to the NGO",
                delivered: "At the NGO — awaiting confirmation",
                completed: "Delivered and verified",
                cancelled: "Order cancelled",
              } as Record<string, string>
            )[status] ?? status}
          </li>
          {!completed && !cancelled && pickup.delay_note && (
            <li className="text-amber-700">Delivery delay: {pickup.delay_note}</li>
          )}
        </ol>
      </section>

      {center ? (
        <NearbyMap markers={markers} center={center} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Restaurant map unavailable: pickup coordinates have not been provided. Address:{" "}
          {listing?.pickup_address}
        </p>
      )}

      {isVolunteer && !completed && !cancelled && (
        <section className="surface-panel grid gap-3 p-5">
          <Label htmlFor="delay-note">Report a delivery delay</Label>
          <Input
            id="delay-note"
            maxLength={240}
            value={delayNote}
            onChange={(e) => setDelayNote(e.target.value)}
            placeholder="For example: waiting at restaurant or delayed by traffic"
          />
          <div className="flex gap-2">
            <Button
              disabled={delay.isPending || !delayNote.trim()}
              onClick={() => delay.mutate({ id: pickupId, note: delayNote })}
            >
              Share delay
            </Button>
            {pickup.delay_note && (
              <Button
                variant="outline"
                disabled={delay.isPending}
                onClick={() => delay.mutate({ id: pickupId, note: "" })}
              >
                Delay resolved
              </Button>
            )}
          </div>
        </section>
      )}

      {!completed &&
        !cancelled &&
        (isVolunteer ? (
          <RiderSharing key={pickupId} pickupId={pickupId} />
        ) : (
          <DeliveryTracking pickupId={pickupId} />
        ))}
      {isVolunteer && !completed && !cancelled && (
        <section className="surface-panel p-5">
          <h2 className="font-semibold">Delivery progress</h2>
          {status === "scheduled" && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Start the journey to collect food from the donor.
              </p>
              <Button
                disabled={advance.isPending}
                onClick={() => advance.mutate({ data: { id: pickupId, status: "en_route" } })}
              >
                <Truck className="mr-1 size-4" /> I’m going to the donor
              </Button>
            </div>
          )}
          {status === "en_route" && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Confirm only after physically collecting the food.
              </p>
              <Button
                disabled={advance.isPending}
                onClick={() => advance.mutate({ data: { id: pickupId, status: "picked_up" } })}
              >
                <PackageCheck className="mr-1 size-4" /> Confirm food collected
              </Button>
            </div>
          )}
          {status === "picked_up" && (
            <div className="mt-3 grid max-w-md gap-2">
              <Label htmlFor="delivery-pin">NGO delivery PIN</Label>
              <p className="text-sm text-muted-foreground">
                Ask the NGO for its six-digit PIN only after handing over the food.
              </p>
              <div className="flex gap-2">
                <Input
                  id="delivery-pin"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="6-digit PIN"
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
                />
                <Button
                  disabled={verifyPin.isPending || pin.length !== 6}
                  onClick={() => verifyPin.mutate({ data: { pickup_id: pickupId, pin } })}
                >
                  <CheckCircle2 className="mr-1 size-4" /> Complete delivery
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {completed && (
        <section className="surface-panel flex items-center gap-3 border-primary/30 bg-primary/5 p-5">
          <CheckCircle2 className="size-6 text-primary" />
          <div>
            <p className="font-semibold">Delivery completed successfully</p>
            <p className="text-sm text-muted-foreground">
              The NGO PIN was verified and the impact record was created.
            </p>
          </div>
        </section>
      )}

      {!activeNavigationUrl && !completed && !cancelled && (
        <p className="text-sm text-destructive">
          Navigation is unavailable until the {travellingToDonor ? "donor listing" : "NGO profile"}{" "}
          has valid latitude and longitude.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <ContactCard title="Receiving NGO" profile={ngo} />
        <ContactCard title="Assigned delivery partner" profile={volunteer} />
      </div>
    </div>
  );
}
