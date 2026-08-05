// Shared, browser-safe helpers and constants for FeedForward.

export type Diet = "veg" | "non_veg" | "vegan" | "mixed";
export type StorageTemp = "hot" | "refrigerated" | "frozen" | "room_temp";
export type AppRole = "donor" | "ngo" | "volunteer" | "admin";

export const FOOD_TYPES = [
  "Cooked meals",
  "Bakery",
  "Fruit & vegetables",
  "Dairy",
  "Packaged / dry goods",
  "Beverages",
  "Other",
] as const;

export const DIET_LABELS: Record<Diet, string> = {
  veg: "Vegetarian",
  non_veg: "Non-veg",
  vegan: "Vegan",
  mixed: "Mixed",
};

export const STORAGE_LABELS: Record<StorageTemp, string> = {
  hot: "Hot / just cooked",
  refrigerated: "Refrigerated",
  frozen: "Frozen",
  room_temp: "Room temperature",
};

/** Safe consumption window (hours) used to suggest a best-before time. */
export const SAFE_WINDOW_HOURS: Record<StorageTemp, number> = {
  hot: 4,
  room_temp: 6,
  refrigerated: 24,
  frozen: 72,
};

export type Urgency = "fresh" | "soon" | "urgent" | "expired";

export function urgencyOf(bestBefore: string | Date, now: Date = new Date()): Urgency {
  const ms = new Date(bestBefore).getTime() - now.getTime();
  const hours = ms / 3_600_000;
  if (hours <= 0) return "expired";
  if (hours <= 1.5) return "urgent";
  if (hours <= 4) return "soon";
  return "fresh";
}

export const URGENCY_LABEL: Record<Urgency, string> = {
  fresh: "Fresh",
  soon: "Use soon",
  urgent: "Urgent",
  expired: "Expired",
};

export function timeLeftLabel(bestBefore: string | Date, now: Date = new Date()): string {
  const ms = new Date(bestBefore).getTime() - now.getTime();
  if (ms <= 0) return "Past best-before";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min left`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m left`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h left`;
}

/** Great-circle distance in km. */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rough conversion helpers used for impact accounting. */
export const KG_PER_SERVING = 0.4;
export const CO2_KG_PER_FOOD_KG = 2.5;

export function toKg(quantity: number, unit: string): number {
  return unit === "kg" ? quantity : quantity * KG_PER_SERVING;
}

export function toMeals(quantity: number, unit: string): number {
  return unit === "kg" ? Math.round(quantity / KG_PER_SERVING) : Math.round(quantity);
}

export function co2Avoided(weightKg: number): number {
  return Math.round(weightKg * CO2_KG_PER_FOOD_KG * 10) / 10;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(n);
}
