import { useEffect, useRef, useState } from "react";

// Minimal shape of the Google Maps JS API surface used here.
type GoogleMapsNamespace = {
  maps: {
    Map: new (el: HTMLElement, opts: Record<string, unknown>) => GoogleMap;
    Marker: new (opts: Record<string, unknown>) => GoogleMarker;
    LatLngBounds: new () => GoogleLatLngBounds;
    SymbolPath: { CIRCLE: unknown };
  };
};

type GoogleMap = {
  fitBounds: (bounds: GoogleLatLngBounds, padding?: number) => void;
};

type GoogleMarker = {
  addListener: (event: string, handler: () => void) => void;
  setMap: (map: GoogleMap | null) => void;
};

type GoogleLatLngBounds = {
  extend: (pos: { lat: number; lng: number }) => void;
};

export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  title: string;
  urgency: "fresh" | "soon" | "urgent" | "expired";
};

const PIN_COLORS: Record<MapMarker["urgency"], string> = {
  fresh: "#2f8f5b",
  soon: "#e0a03a",
  urgent: "#d1462f",
  expired: "#8a8a8a",
};

let loader: Promise<void> | null = null;

function loadMaps(): Promise<void> {
  if (loader) return loader;
  loader = new Promise<void>((resolve, reject) => {
    const key = import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY"];
    const channel = import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID"] ?? "";
    if (!key) {
      reject(new Error("Maps key missing"));
      return;
    }
    const w = window as unknown as Record<string, unknown>;
    w["__ffMapReady"] = () => resolve();
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&loading=async&callback=__ffMapReady&channel=${channel}`;
    script.async = true;
    script.onerror = () => reject(new Error("Maps failed to load"));
    document.head.appendChild(script);
  });
  return loader;
}

export default function NearbyMap({
  markers,
  center,
  onSelect,
}: {
  markers: MapMarker[];
  center: { lat: number; lng: number };
  onSelect?: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const drawn = useRef<GoogleMarker[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMaps()
      .then(() => {
        if (cancelled || !ref.current) return;
        const g = (window as unknown as { google: GoogleMapsNamespace }).google;
        mapRef.current = new g.maps.Map(ref.current, {
          center,
          zoom: 12,
          disableDefaultUI: false,
          streetViewControl: false,
          mapTypeControl: false,
        });
      })
      .catch(() => setError("Map unavailable — showing list only."));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const g = (window as unknown as { google?: GoogleMapsNamespace }).google;
    const map = mapRef.current;
    if (!g || !map) return;
    drawn.current.forEach((m) => m.setMap(null));
    drawn.current = [];
    markers.forEach((m) => {
      const marker = new g.maps.Marker({
        map,
        position: { lat: m.lat, lng: m.lng },
        title: m.title,
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: PIN_COLORS[m.urgency],
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });
      if (onSelect) marker.addListener("click", () => onSelect(m.id));
      drawn.current.push(marker);
    });
    if (markers.length) {
      const bounds = new g.maps.LatLngBounds();
      markers.forEach((m) => bounds.extend({ lat: m.lat, lng: m.lng }));
      bounds.extend(center);
      map.fitBounds(bounds, 60);
    }
  }, [markers, center, onSelect]);

  if (error) {
    return (
      <div className="grid h-72 place-items-center rounded-xl border border-border bg-muted text-sm text-muted-foreground">
        {error}
      </div>
    );
  }

  return <div ref={ref} className="h-72 w-full rounded-xl border border-border" />;
}
