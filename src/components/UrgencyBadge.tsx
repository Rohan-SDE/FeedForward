import { URGENCY_LABEL, timeLeftLabel, urgencyOf, type Urgency } from "@/lib/food";
import { cn } from "@/lib/utils";

const styles: Record<Urgency, string> = {
  fresh: "bg-fresh text-fresh-foreground",
  soon: "bg-soon text-soon-foreground",
  urgent: "bg-urgent text-urgent-foreground",
  expired: "bg-muted text-muted-foreground",
};

export function UrgencyBadge({
  bestBefore,
  status,
  showTime = false,
}: {
  bestBefore: string;
  status?: string;
  showTime?: boolean;
}) {
  const u = urgencyOf(bestBefore);
  const label =
    status && ["cancelled", "completed"].includes(status)
      ? status === "completed"
        ? "Completed"
        : "Cancelled"
      : URGENCY_LABEL[u];

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
        status && ["cancelled", "completed"].includes(status) ? styles.expired : styles[u],
      )}
    >
      {label}
      {showTime && u !== "expired" && (
        <span className="font-normal opacity-80">· {timeLeftLabel(bestBefore)}</span>
      )}
    </span>
  );
}
