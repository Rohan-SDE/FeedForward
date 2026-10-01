import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import NearbyMap from "@/components/NearbyMap";
import {
  readDeliveryLocation,
  setRiderPresence,
  shareDeliveryLocation,
  stopDeliveryLocation,
} from "@/lib/feedforward.functions";

export function RiderSharing({ pickupId }: { pickupId?: string }) {
  const [enabled, setEnabled] = useState(Boolean(pickupId));
  const [stopping, setStopping] = useState(false);
  const sharing = useRef(Boolean(pickupId));
  const pending = useRef<Promise<unknown>>(Promise.resolve());
  const [message, setMessage] = useState("");
  const lastPosition = useRef<{ latitude: number; longitude: number }>({
    latitude: 0,
    longitude: 0,
  });
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    if (!navigator.geolocation) {
      sharing.current = false;
      setEnabled(false);
      setMessage("Geolocation is unavailable in this browser.");
      return;
    }
    setMessage("Requesting location permission…");
    let alive = true;
    let busy = false;
    const send = () => {
      if (busy || !alive || !sharing.current) return;
      busy = true;
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          if (!alive || !sharing.current) {
            busy = false;
            return;
          }
          const coords = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          };
          lastPosition.current = coords;
          try {
            pending.current = pickupId
              ? shareDeliveryLocation(pickupId, {
                  ...coords,
                  accuracy: Math.min(position.coords.accuracy, 10000),
                })
              : setRiderPresence({ ...coords, available: true });
            await pending.current;
            if (alive) {
              setMessage(`Updated ${new Date().toLocaleTimeString()}`);
              void qc.invalidateQueries({ queryKey: ["pickups"] });
            }
          } catch (error) {
            if (alive)
              setMessage(error instanceof Error ? error.message : "Location update failed");
          } finally {
            busy = false;
          }
        },
        (error) => {
          busy = false;
          if (alive) {
            setMessage(
              error.code === 1
                ? "Location permission denied. Allow it in browser settings to continue."
                : "Could not get your location. Try again outdoors or check GPS.",
            );
            setEnabled(false);
          }
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 },
      );
    };
    send();
    const timer = window.setInterval(send, 20000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [enabled, pickupId, qc]);
  const stop = async () => {
    sharing.current = false;
    setStopping(true);
    setEnabled(false);
    await pending.current.catch(() => undefined);
    try {
      if (pickupId) await stopDeliveryLocation(pickupId);
      else await setRiderPresence({ ...lastPosition.current, available: false });
      setMessage("Stopped");
    } catch {
      setMessage(
        "Could not confirm stop with server. Availability expires after 90 seconds; shared delivery positions expire after 5 minutes.",
      );
    } finally {
      setStopping(false);
    }
  };
  return (
    <section className="surface-panel p-5">
      <h2 className="font-semibold">
        {pickupId ? "Share delivery location" : "Automatic rider assignments"}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {pickupId
          ? "Location sharing starts automatically for this active delivery. Allow browser location permission to share your GPS position with the receiving NGO."
          : "Go available to allow nearby deliveries to be assigned to you automatically, one at a time."}{" "}
        Keep this page open and your phone awake. Browser tracking stops when the page is closed or
        suspended.
      </p>
      <Button
        disabled={stopping}
        className="mt-3"
        variant={enabled ? "outline" : "default"}
        onClick={() => {
          if (enabled) {
            void stop();
            return;
          }
          if (!navigator.geolocation) {
            setMessage("Geolocation is unavailable in this browser.");
            return;
          }
          setMessage("Requesting location permission…");
          sharing.current = true;
          setEnabled(true);
        }}
      >
        {enabled ? "Stop" : pickupId ? "Start sharing location" : "Go available"}
      </Button>
      <p className="mt-2 text-sm" role="status">
        {message}
      </p>
    </section>
  );
}

export function DeliveryTracking({ pickupId }: { pickupId: string }) {
  const query = useQuery({
    queryKey: ["deliveryLocation", pickupId],
    queryFn: () => readDeliveryLocation(pickupId),
    refetchInterval: 10000,
  });
  const point = query.data?.location;
  const stale = point ? Date.now() - new Date(point.updated_at).getTime() > 60000 : false;
  return (
    <section className="surface-panel p-5">
      <h2 className="font-semibold">Delivery partner location</h2>
      {query.isError ? (
        <p className="mt-2 text-sm" role="alert">
          {query.error.message}
        </p>
      ) : query.isLoading ? (
        <p className="mt-2 text-sm">Loading location…</p>
      ) : point ? (
        <>
          <p className="my-3 text-sm">
            {stale ? "Last known position — updates delayed" : "Recent GPS position"} · updated{" "}
            {new Date(point.updated_at).toLocaleTimeString()} · accuracy ±
            {Math.round(point.accuracy)} m
          </p>
          <NearbyMap
            center={{ lat: point.latitude, lng: point.longitude }}
            markers={[
              {
                id: "rider",
                lat: point.latitude,
                lng: point.longitude,
                title: "Delivery partner",
                urgency: "fresh",
              },
            ]}
          />
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Waiting for the rider’s location. Sharing starts automatically when the assigned rider
          opens this delivery, provided browser location permission is allowed.
        </p>
      )}
    </section>
  );
}
