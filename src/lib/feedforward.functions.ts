import { supabase } from "@/integrations/supabase/client";
import type { Row } from "@/lib/rows";

const API_URL = (import.meta.env["VITE_API_URL"] || "http://localhost:8000").replace(/\/$/, "");

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session expired. Please sign in again.");

  const method = (options.method ?? "GET").toUpperCase();
  let response: Response | undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch(`${API_URL}${path}`, {
        ...options,
        signal: options.signal ?? AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });
    } catch (error) {
      if (method === "GET" && attempt === 0) continue;
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new Error("The server took too long to respond. Please try again.");
      }
      throw new Error("Could not reach the FeedForward server. Check your connection.");
    }

    if (method === "GET" && attempt === 0 && [502, 503, 504].includes(response.status)) {
      continue;
    }
    break;
  }

  if (!response) throw new Error("Could not reach the FeedForward server.");
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      detail?: string | Array<{ msg?: string }>;
    } | null;
    const detail =
      typeof body?.detail === "string"
        ? body.detail
        : Array.isArray(body?.detail)
          ? body.detail
              .map((item) => item.msg)
              .filter(Boolean)
              .join(". ")
          : "";
    throw new Error(detail || `API request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

const post = <T>(path: string, data: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(data) });

export type ApiInput<T> = { data: T };

export const getMe = () => api<{ userId: string; profile: Row | null; roles: string[] }>("/api/me");
export const saveProfile = ({ data }: ApiInput<Row>) =>
  api<{ ok: boolean }>("/api/profile", { method: "PATCH", body: JSON.stringify(data) });
export const setMyRole = ({ data }: ApiInput<{ role: "donor" | "ngo" | "volunteer" }>) =>
  post<{ ok: boolean }>("/api/roles", data);

export const createListing = ({ data }: ApiInput<Row>) =>
  post<{ id: string }>("/api/listings", data);
export const cancelListing = ({ data }: ApiInput<{ id: string }>) =>
  post<{ ok: boolean }>("/api/listings/cancel", data);
export const browseListings = () => api<Row[]>("/api/listings");
export const myListings = () => api<Row[]>("/api/listings/mine");

export const claimListing = ({ data }: ApiInput<Row>) => post<{ id: string }>("/api/claims", data);
export const myClaims = () => api<Row[]>("/api/claims/mine");
export const cancelClaim = ({ data }: ApiInput<{ id: string }>) =>
  post<{ ok: boolean }>("/api/claims/cancel", data);

export const schedulePickup = ({ data }: ApiInput<Row>) =>
  post<{ ok: boolean; pickupId: string; deliveryPin: string }>("/api/pickups/request", data);
export const listNearbyDeliveryRequests = () =>
  api<{ requiresLocation: boolean; requests: Row[] }>("/api/delivery-requests/nearby");
export const acceptDeliveryRequest = ({ data }: ApiInput<{ pickup_id: string }>) =>
  post<{ ok: boolean; pickupId: string }>("/api/delivery-requests/accept", data);
export const listNotifications = () =>
  api<{ items: Row[]; unreadCount: number }>("/api/notifications");
export const markNotificationRead = ({ data }: ApiInput<{ id: string }>) =>
  post<{ ok: boolean }>(`/api/notifications/${encodeURIComponent(data.id)}/read`, {});
export const markAllNotificationsRead = () =>
  post<{ ok: boolean }>("/api/notifications/read-all", {});
export const listMyDeliveryPins = () => api<Row[]>("/api/delivery-pins");
export const listPickups = () => api<Row[]>("/api/pickups");
export const getDeliveryDetails = (pickupId: string) =>
  api<{ pickup: Row; ngo: Row | null; volunteer: Row | null }>(
    `/api/pickups/${encodeURIComponent(pickupId)}/delivery-details`,
  );
export const verifyDeliveryPin = ({ data }: ApiInput<{ pickup_id: string; pin: string }>) =>
  post<{ ok: boolean }>("/api/pickups/verify-pin", data);
export const advancePickup = ({ data }: ApiInput<Row>) =>
  post<{ ok: boolean }>("/api/pickups/advance", data);

export const getMyFeedbackStatus = () => api<Row[]>("/api/feedback/status");
export const submitDeliveryFeedback = ({ data }: ApiInput<Row>) =>
  post<{ id: string }>("/api/feedback", data);
export const listAdminFeedback = () => api<Row[]>("/api/admin/feedback");

export const getImpact = () => api<{ records: Row[] }>("/api/impact");
export const adminOverview = () =>
  api<{ profiles: Row[]; roles: Row[]; listings: Row[] }>("/api/admin/overview");
export const setVerified = ({ data }: ApiInput<{ id: string; verified: boolean }>) =>
  post<{ ok: boolean }>("/api/admin/verified", data);

export const optimizeRoute = ({ data }: ApiInput<Row>) =>
  post<{
    order: Array<{
      id: string;
      label: string;
      lat: number;
      lng: number;
      legKm: number;
      legMinutes: number;
    }>;
    totalKm: number;
    totalMinutes: number;
  }>("/api/routes/optimize", data);

export const uploadFoodPhoto = (file: File) =>
  api<{ url: string }>("/api/photos", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
    signal: AbortSignal.timeout(30_000),
  });

export type NearbyNgo = {
  id: string;
  name: string;
  city: string | null;
  verified: boolean;
  distanceKm: number;
};
export const listNearbyNgos = () =>
  api<{ requiresLocation: boolean; radiusKm?: number; ngos: NearbyNgo[]; searchLimited: boolean }>(
    "/api/ngos/nearby",
  );

export const claimWithDelivery = ({ data }: ApiInput<Row>) =>
  post<{ id: string; pickup_id: string | null }>("/api/claims/with-delivery", data);
export const setRiderPresence = (data: {
  available: boolean;
  latitude: number;
  longitude: number;
}) => post<{ ok: boolean }>("/api/riders/presence", data);
export type DeliveryLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  updated_at: string;
};
export const readDeliveryLocation = (id: string) =>
  api<{ location: DeliveryLocation | null }>(`/api/pickups/${encodeURIComponent(id)}/location`);
export const shareDeliveryLocation = (
  id: string,
  data: { latitude: number; longitude: number; accuracy: number },
) => post<{ ok: boolean }>(`/api/pickups/${encodeURIComponent(id)}/location`, data);
export const stopDeliveryLocation = (id: string) =>
  post<{ ok: boolean }>(`/api/pickups/${encodeURIComponent(id)}/location/stop`, {});

export const updatePreparation = (data: { id: string; status: string }) =>
  post<{ ok: boolean }>(`/api/listings/${encodeURIComponent(data.id)}/preparation`, {
    status: data.status,
  });
export const reportDeliveryDelay = (data: { id: string; note: string }) =>
  post<{ ok: boolean }>(`/api/pickups/${encodeURIComponent(data.id)}/delay`, { note: data.note });
