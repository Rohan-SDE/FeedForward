import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { co2Avoided, toKg, toMeals } from "./food";

/* ---------------------------------- profile --------------------------------- */

export const getMe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: profile }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    return {
      userId,
      profile: profile ?? null,
      roles: (roles ?? []).map((r) => r.role as string),
    };
  });

export const saveProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        full_name: z.string().trim().min(1).max(120),
        org_name: z.string().trim().max(160).optional().nullable(),
        phone: z.string().trim().max(32).optional().nullable(),
        address: z.string().trim().max(300).optional().nullable(),
        city: z.string().trim().max(120).optional().nullable(),
        latitude: z.number().min(-90).max(90).optional().nullable(),
        longitude: z.number().min(-180).max(180).optional().nullable(),
        service_radius_km: z.number().min(1).max(200).optional(),
        food_preferences: z.array(z.string().max(60)).max(12).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update(data as never)
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setMyRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ role: z.enum(["donor", "ngo", "volunteer"]) }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("user_roles")
      .insert({ user_id: context.userId, role: data.role });
    if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    return { ok: true };
  });

/* --------------------------------- listings --------------------------------- */

const listingInput = z.object({
  title: z.string().trim().min(3).max(140),
  food_type: z.string().trim().min(2).max(80),
  description: z.string().trim().max(1000).optional().nullable(),
  quantity: z.number().positive().max(100000),
  unit: z.enum(["servings", "kg"]),
  diet: z.enum(["veg", "non_veg", "vegan", "mixed"]),
  allergens: z.string().trim().max(300).optional().nullable(),
  storage: z.enum(["hot", "refrigerated", "frozen", "room_temp"]),
  photo_url: z.string().trim().url().max(600).optional().nullable(),
  prepared_at: z.string(),
  best_before: z.string(),
  pickup_address: z.string().trim().min(4).max(300),
  city: z.string().trim().max(120).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
});

export const createListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => listingInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("food_listings")
      .insert({ ...data, donor_id: context.userId } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const updateListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), patch: listingInput.partial() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("food_listings")
      .update(data.patch as never)
      .eq("id", data.id)
      .eq("donor_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const cancelListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("food_listings")
      .update({ status: "cancelled" })
      .eq("id", data.id)
      .eq("donor_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Listings still open for claims. Uses a privileged client with an explicit
 * safe-column projection so browsers never receive the exact pickup address,
 * precise coordinates or donor contact details before a claim exists.
 */
export const browseListings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("food_listings")
      .select(
        "id, donor_id, title, food_type, description, quantity, unit, claimed_quantity, diet, allergens, storage, photo_url, prepared_at, best_before, city, status, created_at, latitude, longitude",
      )
      .in("status", ["posted", "claimed", "scheduled"])
      .order("best_before", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);

    const donorIds = [...new Set((data ?? []).map((l) => l.donor_id))];
    const { data: donors } = donorIds.length
      ? await supabaseAdmin
          .from("profiles")
          .select("id, org_name, full_name, verified")
          .in("id", donorIds)
      : { data: [] };

    const byId = new Map((donors ?? []).map((d) => [d.id, d]));
    // Coordinates are coarsened to ~1km so exact pickup points stay private.
    const coarse = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);
    return (data ?? []).map((l) => ({
      ...l,
      latitude: coarse(l.latitude),
      longitude: coarse(l.longitude),
      area: l.city ?? "Approximate area shown until claimed",
      donor: byId.get(l.donor_id) ?? null,
    }));
  });

export const myListings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("food_listings")
      .select("*, claims(*)")
      .eq("donor_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/* ---------------------------------- claims ---------------------------------- */

export const claimListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        listing_id: z.string().uuid(),
        claimed_quantity: z.number().positive().max(100000),
        note: z.string().trim().max(400).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: listing, error: le } = await supabase
      .from("food_listings")
      .select("id, quantity, claimed_quantity, status, best_before")
      .eq("id", data.listing_id)
      .maybeSingle();
    if (le) throw new Error(le.message);
    if (!listing) throw new Error("Listing not found");
    if (new Date(listing.best_before).getTime() < Date.now())
      throw new Error("This listing is past its best-before window");
    if (!["posted", "claimed"].includes(listing.status))
      throw new Error("This listing is no longer open for claims");

    const remaining = Number(listing.quantity) - Number(listing.claimed_quantity);
    if (data.claimed_quantity > remaining + 1e-9)
      throw new Error(`Only ${remaining} left to claim`);

    const { data: claim, error } = await supabase
      .from("claims")
      .insert({
        listing_id: data.listing_id,
        ngo_id: userId,
        claimed_quantity: data.claimed_quantity,
        note: data.note ?? null,
        status: "confirmed",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const newClaimed = Number(listing.claimed_quantity) + data.claimed_quantity;
    await supabase
      .from("food_listings")
      .update({ claimed_quantity: newClaimed, status: "claimed" })
      .eq("id", listing.id);

    return { id: claim.id };
  });

export const myClaims = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("claims")
      .select("*, food_listings(*), pickups(*)")
      .eq("ngo_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const cancelClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: claim } = await supabase
      .from("claims")
      .select("id, listing_id, claimed_quantity, status")
      .eq("id", data.id)
      .eq("ngo_id", userId)
      .maybeSingle();
    if (!claim) throw new Error("Claim not found");

    const { error } = await supabase
      .from("claims")
      .update({ status: "cancelled" })
      .eq("id", claim.id);
    if (error) throw new Error(error.message);

    const { data: listing } = await supabase
      .from("food_listings")
      .select("quantity, claimed_quantity")
      .eq("id", claim.listing_id)
      .maybeSingle();
    if (listing) {
      const claimed = Math.max(
        0,
        Number(listing.claimed_quantity) - Number(claim.claimed_quantity),
      );
      await supabase
        .from("food_listings")
        .update({ claimed_quantity: claimed, status: claimed > 0 ? "claimed" : "posted" })
        .eq("id", claim.listing_id);
    }
    return { ok: true };
  });

/* --------------------------------- pickups ---------------------------------- */

export const schedulePickup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        claim_id: z.string().uuid(),
        scheduled_time: z.string(),
        volunteer_id: z.string().uuid().optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("pickups").insert({
      claim_id: data.claim_id,
      scheduled_time: data.scheduled_time,
      volunteer_id: data.volunteer_id ?? null,
    });
    if (error) throw new Error(error.message);
    await supabase.from("claims").update({ status: "scheduled" }).eq("id", data.claim_id);
    return { ok: true };
  });

export const listPickups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("pickups")
      .select("*, claims(*, food_listings(*))")
      .order("scheduled_time", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const advancePickup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["en_route", "picked_up", "delivered", "completed", "cancelled"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: Record<string, string> = { status: data.status };
    if (data.status === "picked_up") patch["actual_pickup_time"] = new Date().toISOString();
    if (data.status === "delivered") patch["delivered_time"] = new Date().toISOString();

    const { error } = await supabase
      .from("pickups")
      .update(patch as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    const { data: pickup } = await supabase
      .from("pickups")
      .select("id, claim_id, claims(id, ngo_id, claimed_quantity, listing_id)")
      .eq("id", data.id)
      .maybeSingle();
    const claim = pickup?.claims as
      | { id: string; ngo_id: string; claimed_quantity: number; listing_id: string }
      | null
      | undefined;
    if (!claim) return { ok: true };

    const claimStatusMap: Record<
      string,
      "scheduled" | "picked_up" | "delivered" | "completed" | "cancelled"
    > = {
      en_route: "scheduled",
      picked_up: "picked_up",
      delivered: "delivered",
      completed: "completed",
      cancelled: "cancelled",
    };
    await supabase
      .from("claims")
      .update({ status: claimStatusMap[data.status] ?? "scheduled" })
      .eq("id", claim.id);

    if (data.status === "completed") {
      const { data: listing } = await supabase
        .from("food_listings")
        .select("id, donor_id, unit, food_type, city, quantity, claimed_quantity")
        .eq("id", claim.listing_id)
        .maybeSingle();
      if (listing) {
        const qty = Number(claim.claimed_quantity);
        const weight = toKg(qty, listing.unit);
        const { data: existing } = await supabase
          .from("impact_records")
          .select("id")
          .eq("pickup_id", data.id)
          .maybeSingle();
        if (!existing) {
          await supabase.from("impact_records").insert({
            pickup_id: data.id,
            donor_id: listing.donor_id,
            ngo_id: claim.ngo_id ?? userId,
            city: listing.city,
            food_type: listing.food_type,
            meals_saved: toMeals(qty, listing.unit),
            weight_kg: Math.round(weight * 10) / 10,
            co2_avoided_kg: co2Avoided(weight),
          });
        }
        const fullyClaimed = Number(listing.claimed_quantity) >= Number(listing.quantity) - 1e-9;
        await supabase
          .from("food_listings")
          .update({ status: fullyClaimed ? "completed" : "posted" })
          .eq("id", listing.id);
      }
    }
    return { ok: true };
  });

/* ---------------------------------- impact ---------------------------------- */

/**
 * Community impact. Records are aggregated and stripped of donor/NGO identity
 * before leaving the server; only non-identifying metrics are returned.
 */
export const getImpact = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: records, error }, { data: orgs }, { data: listings }] = await Promise.all([
      supabaseAdmin
        .from("impact_records")
        .select("id, city, food_type, meals_saved, weight_kg, co2_avoided_kg, completed_at")
        .order("completed_at", { ascending: true })
        .limit(2000),
      supabaseAdmin.from("profiles").select("id, org_name, full_name, city, verified"),
      supabaseAdmin.from("food_listings").select("id, status"),
    ]);
    if (error) throw new Error(error.message);
    return {
      records: records ?? [],
      profiles: orgs ?? [],
      activeListings: (listings ?? []).filter((l) =>
        ["posted", "claimed", "scheduled"].includes(l.status),
      ).length,
    };
  });

/* ---------------------------------- admin ----------------------------------- */

export const adminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: isAdmin } = await supabase.rpc("is_admin");
    if (!isAdmin) throw new Error("Admins only");

    const [{ data: profiles }, { data: roles }, { data: listings }] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("food_listings").select("id, status, donor_id, created_at"),
    ]);
    return {
      profiles: profiles ?? [],
      roles: roles ?? [],
      listings: listings ?? [],
    };
  });

export const setVerified = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), verified: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_admin");
    if (!isAdmin) throw new Error("Admins only");

    const { error } = await context.supabase
      .from("profiles")
      .update({ verified: data.verified })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ------------------------------ route planning ------------------------------ */

/** Orders stops with a nearest-neighbour pass over the Google Routes matrix. */
export const optimizeRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        origin: z.object({ lat: z.number(), lng: z.number() }),
        stops: z
          .array(
            z.object({
              id: z.string(),
              label: z.string().max(200),
              lat: z.number(),
              lng: z.number(),
            }),
          )
          .min(1)
          .max(9),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const lovableKey = process.env["LOVABLE_API_KEY"];
    const mapsKey = process.env["GOOGLE_MAPS_API_KEY"];
    if (!lovableKey || !mapsKey) throw new Error("Maps credentials are not configured");

    const points = [
      { id: "origin", label: "Start", lat: data.origin.lat, lng: data.origin.lng },
      ...data.stops,
    ];
    const waypoints = points.map((p) => ({
      waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } },
    }));

    const res = await fetch(
      "https://connector-gateway.lovable.dev/google_maps/routes/distanceMatrix/v2:computeRouteMatrix",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": mapsKey,
          "Content-Type": "application/json",
          "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,condition",
        },
        body: JSON.stringify({
          origins: waypoints,
          destinations: waypoints,
          travelMode: "DRIVE",
        }),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      console.error(`Routes matrix failed [${res.status}]: ${body}`);
      throw new Error(`Route planning failed (${res.status})`);
    }

    const rows = (await res.json()) as Array<{
      originIndex: number;
      destinationIndex: number;
      duration?: string;
      distanceMeters?: number;
    }>;

    const n = points.length;
    const dur = Array.from({ length: n }, () => Array(n).fill(Number.MAX_SAFE_INTEGER));
    const dist = Array.from({ length: n }, () => Array(n).fill(0));
    for (const r of rows) {
      const seconds = Number(String(r.duration ?? "0").replace("s", "")) || 0;
      dur[r.originIndex]![r.destinationIndex] = seconds;
      dist[r.originIndex]![r.destinationIndex] = r.distanceMeters ?? 0;
    }

    const unvisited = new Set(points.slice(1).map((_, i) => i + 1));
    let current = 0;
    let totalSeconds = 0;
    let totalMeters = 0;
    const order: Array<{
      id: string;
      label: string;
      lat: number;
      lng: number;
      legMinutes: number;
      legKm: number;
    }> = [];

    while (unvisited.size) {
      let best = -1;
      let bestSeconds = Number.MAX_SAFE_INTEGER;
      for (const idx of unvisited) {
        const s = dur[current]![idx]!;
        if (s < bestSeconds) {
          bestSeconds = s;
          best = idx;
        }
      }
      if (best < 0) break;
      const p = points[best]!;
      const meters = dist[current]![best]! as number;
      totalSeconds += bestSeconds === Number.MAX_SAFE_INTEGER ? 0 : bestSeconds;
      totalMeters += meters;
      order.push({
        id: p.id,
        label: p.label,
        lat: p.lat,
        lng: p.lng,
        legMinutes: Math.round((bestSeconds === Number.MAX_SAFE_INTEGER ? 0 : bestSeconds) / 60),
        legKm: Math.round((meters / 1000) * 10) / 10,
      });
      unvisited.delete(best);
      current = best;
    }

    return {
      order,
      totalMinutes: Math.round(totalSeconds / 60),
      totalKm: Math.round((totalMeters / 1000) * 10) / 10,
    };
  });
