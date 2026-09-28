import { useEffect, useId, useRef, useState } from "react";
import { OlaMaps } from "olamaps-web-sdk";

type Coordinates = {
  lat: number;
  lng: number;
};

type OlaMapInstance = {
  setCenter: (center: [number, number]) => void;
  setZoom: (zoom: number) => void;
  fitBounds: (
    bounds: [[number, number], [number, number]],
    options?: {
      padding?: number;
      maxZoom?: number;
    },
  ) => void;
  remove: () => void;
};

type OlaMarkerInstance = {
  setLngLat: (coordinates: [number, number]) => OlaMarkerInstance;
  addTo: (map: OlaMapInstance) => OlaMarkerInstance;
  getElement: () => HTMLElement;
  remove: () => void;
};

type OlaMapsClient = {
  init: (options: {
    style: string;
    container: string;
    center: [number, number];
    zoom: number;
  }) => OlaMapInstance | Promise<OlaMapInstance>;

  addMarker: (options?: { color?: string }) => OlaMarkerInstance;
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

const MAP_STYLE = "https://api.olamaps.io/tiles/vector/v1/styles/default-light-standard/style.json";

function isValidMarker(marker: MapMarker): boolean {
  return (
    Number.isFinite(marker.lat) &&
    Number.isFinite(marker.lng) &&
    marker.lat >= -90 &&
    marker.lat <= 90 &&
    marker.lng >= -180 &&
    marker.lng <= 180
  );
}

export default function NearbyMap({
  markers,
  center,
  onSelect,
}: {
  markers: MapMarker[];
  center: Coordinates;
  onSelect?: (id: string) => void;
}) {
  const reactId = useId();
  const containerId = `ola-map-${reactId.replace(/:/g, "")}`;

  const mapRef = useRef<OlaMapInstance | null>(null);
  const olaMapsRef = useRef<OlaMapsClient | null>(null);
  const markerRefs = useRef<OlaMarkerInstance[]>([]);
  const initialCenterRef = useRef(center);
  const onSelectRef = useRef(onSelect);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const centerLat = center.lat;
  const centerLng = center.lng;

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    let cancelled = false;

    async function initialiseMap() {
      try {
        setError(null);

        const apiKey = import.meta.env["VITE_OLA_MAPS_API_KEY"];

        if (!apiKey) {
          throw new Error("VITE_OLA_MAPS_API_KEY is missing from .env.local");
        }

        const olaMaps = new OlaMaps({
          apiKey,
        }) as unknown as OlaMapsClient;

        const initial = initialCenterRef.current;

        if (!Number.isFinite(initial.lat) || !Number.isFinite(initial.lng)) {
          throw new Error("The initial map coordinates are invalid");
        }

        const map = await Promise.resolve(
          olaMaps.init({
            style: MAP_STYLE,
            container: containerId,
            center: [initial.lng, initial.lat],
            zoom: 12,
          }),
        );

        if (cancelled) {
          map.remove();
          return;
        }

        olaMapsRef.current = olaMaps;
        mapRef.current = map;
        setReady(true);
      } catch (mapError) {
        console.error("Unable to initialise Ola Maps:", mapError);

        if (!cancelled) {
          setError("Ola Maps could not be loaded. Check the API key and domain whitelist.");
        }
      }
    }

    initialiseMap();

    return () => {
      cancelled = true;

      markerRefs.current.forEach((marker) => {
        marker.remove();
      });

      markerRefs.current = [];

      mapRef.current?.remove();
      mapRef.current = null;
      olaMapsRef.current = null;
    };
  }, [containerId]);

  useEffect(() => {
    const map = mapRef.current;
    const olaMaps = olaMapsRef.current;

    if (!ready || !map || !olaMaps) {
      return;
    }

    markerRefs.current.forEach((marker) => {
      marker.remove();
    });

    markerRefs.current = [];

    const validMarkers = markers.filter(isValidMarker);

    validMarkers.forEach((marker) => {
      const olaMarker = olaMaps
        .addMarker({
          color: PIN_COLORS[marker.urgency],
        })
        .setLngLat([marker.lng, marker.lat])
        .addTo(map);

      const element = olaMarker.getElement();

      element.title = marker.title;
      element.setAttribute("aria-label", marker.title);
      element.setAttribute("role", "button");
      element.tabIndex = 0;

      const selectMarker = () => {
        onSelectRef.current?.(marker.id);
      };

      element.addEventListener("click", selectMarker);

      element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectMarker();
        }
      });

      markerRefs.current.push(olaMarker);
    });

    if (validMarkers.length === 0) {
      map.setCenter([centerLng, centerLat]);
      map.setZoom(12);
      return;
    }

    const onlyMarker = validMarkers[0];

    if (validMarkers.length === 1 && onlyMarker) {
      map.setCenter([onlyMarker.lng, onlyMarker.lat]);
      map.setZoom(14);
      return;
    }

    const longitudes = validMarkers.map((marker) => marker.lng);
    const latitudes = validMarkers.map((marker) => marker.lat);

    map.fitBounds(
      [
        [Math.min(...longitudes, centerLng), Math.min(...latitudes, centerLat)],
        [Math.max(...longitudes, centerLng), Math.max(...latitudes, centerLat)],
      ],
      {
        padding: 50,
        maxZoom: 15,
      },
    );
  }, [ready, markers, centerLat, centerLng]);

  if (error) {
    return (
      <div
        className="grid h-72 place-items-center rounded-xl border border-border bg-muted px-6 text-center text-sm text-muted-foreground"
        role="alert"
      >
        {error}
      </div>
    );
  }

  return (
    <div className="relative h-72 w-full overflow-hidden rounded-xl border border-border">
      <div
        id={containerId}
        className="h-full w-full"
        aria-label="Ola Map showing nearby surplus food"
      />

      {!ready && (
        <div className="absolute inset-0 grid place-items-center bg-muted text-sm text-muted-foreground">
          Loading Ola Maps…
        </div>
      )}
    </div>
  );
}
