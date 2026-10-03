# Mentor Review Guide

## 5-minute demo script

1. **Problem (30 sec):** Restaurants and events have edible surplus food, while nearby
   NGOs need a fast, trustworthy way to find and collect it before expiry.
2. **Donor flow (60 sec):** Sign in as a donor, open **Post surplus**, capture location,
   set the food-safety window, and publish a listing.
3. **NGO flow (90 sec):** Sign in as an NGO, filter **Nearby food**, show approximate
   map/list location privacy, claim part or all of the available quantity, and schedule it.
4. **Pickup flow (60 sec):** Advance the pickup through en route, picked up, delivered,
   and completed.
5. **Impact/admin (60 sec):** Show meals saved/CO2 avoided and verify an organisation
   from the admin page.

## Architecture explanation

- TanStack Start provides the React UI and authenticated server functions.
- Supabase Auth issues the user session token.
- Server middleware verifies the token and creates a user-scoped database client.
- PostgreSQL Row Level Security is the final authorization boundary.
- A locked SQL function atomically reserves food quantity when an NGO claims a listing.
- Service-role reads are limited to server-only functions with explicit safe columns.

## Important design decisions

- One account gets one operational role; users cannot self-assign admin access.
- Volunteers cannot donate. Only donors (and explicitly trusted admins) can post food.
- Only NGOs can claim food.
- Exact pickup addresses are hidden while browsing; coarse coordinates are shown until a
  legitimate claim exists.
- Claim quantity is checked under a row lock, preventing concurrent over-claiming.
- The app falls back to a list if the Maps key is missing or invalid.

## Questions you may be asked

**Why Supabase/PostgreSQL?** It gives the MVP managed authentication, relational data,
transactions, and database-level authorization while keeping the frontend small.

**Why not trust frontend role checks?** UI checks improve usability, but requests can be
forged. Server checks and RLS enforce the same rule even if someone bypasses the UI.

**How do you avoid two NGOs claiming the same quantity?** The claim function locks the
listing row, validates the remaining quantity, inserts the claim, and updates the total in
one database transaction.

**How is location privacy handled?** Browse results omit the pickup address and round
coordinates. Exact details are available only to involved pickup parties through RLS.

**What would you build next?** Background expiry jobs, notifications, uploaded food
photos, PostGIS radius queries, automated integration tests, monitoring, and deployment
CI.

## Demo preparation

- Use separate browser profiles for donor, NGO, and admin sessions.
- Prepare one listing with a best-before time at least two hours in the future.
- Keep the donor and NGO locations within a few kilometres.
- Verify that `20260907000100_production_role_and_claim_safety.sql` is applied.
- Keep screenshots ready in case venue internet is unstable.
