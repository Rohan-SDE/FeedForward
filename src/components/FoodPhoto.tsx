import { useEffect, useMemo, useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

function safeImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export default function FoodPhoto({
  src,
  alt,
  className,
}: {
  src: unknown;
  alt: string;
  className?: string;
}) {
  const url = useMemo(() => safeImageUrl(src), [src]);
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [url]);

  if (!url || failed) {
    return (
      <div
        className={cn(
          "grid place-items-center rounded-xl border border-border bg-muted text-muted-foreground",
          className,
        )}
      >
        <span className="flex items-center gap-2 text-xs">
          <ImageOff className="size-4" /> {url ? "Photo unavailable" : "No food photo"}
        </span>
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      className={cn("rounded-xl border border-border object-cover", className)}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
