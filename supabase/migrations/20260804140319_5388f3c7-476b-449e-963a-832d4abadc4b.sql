-- 1. Admin list + non-definer admin check ------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.admin_users TO authenticated;
GRANT ALL ON public.admin_users TO service_role;

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own admin row" ON public.admin_users;
CREATE POLICY "Users see own admin row" ON public.admin_users
  FOR SELECT TO authenticated USING (user_id = auth.uid());

INSERT INTO public.admin_users (user_id)
SELECT user_id FROM public.user_roles WHERE role = 'admin'
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = auth.uid());
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- has_role is SECURITY DEFINER: no longer callable by signed-in users
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM authenticated;

-- 2. user_roles ---------------------------------------------------------------
DROP POLICY IF EXISTS "Users view own roles" ON public.user_roles;
CREATE POLICY "Users view own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- 3. profiles -----------------------------------------------------------------
DROP POLICY IF EXISTS "Signed-in users can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins update any profile" ON public.profiles;

CREATE POLICY "Own admin or related profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.claims c
      JOIN public.food_listings l ON l.id = c.listing_id
      WHERE c.status <> 'cancelled'
        AND (
          (c.ngo_id = auth.uid() AND l.donor_id = public.profiles.id)
          OR (l.donor_id = auth.uid() AND c.ngo_id = public.profiles.id)
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.pickups p
      JOIN public.claims c ON c.id = p.claim_id
      JOIN public.food_listings l ON l.id = c.listing_id
      WHERE (
        (p.volunteer_id = auth.uid() AND public.profiles.id IN (c.ngo_id, l.donor_id))
        OR (public.profiles.id = p.volunteer_id AND auth.uid() IN (c.ngo_id, l.donor_id))
      )
    )
  );

CREATE POLICY "Admins update any profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE OR REPLACE VIEW public.org_directory AS
  SELECT id, org_name, full_name, city, verified FROM public.profiles;

GRANT SELECT ON public.org_directory TO authenticated;

-- 4. food_listings ------------------------------------------------------------
DROP POLICY IF EXISTS "Signed-in users can view listings" ON public.food_listings;
DROP POLICY IF EXISTS "Donors update own listings" ON public.food_listings;
DROP POLICY IF EXISTS "Donors delete own listings" ON public.food_listings;

CREATE POLICY "Involved parties view listings" ON public.food_listings
  FOR SELECT TO authenticated
  USING (
    donor_id = auth.uid()
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.claims c
      WHERE c.listing_id = public.food_listings.id AND c.ngo_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.pickups p
      JOIN public.claims c ON c.id = p.claim_id
      WHERE c.listing_id = public.food_listings.id AND p.volunteer_id = auth.uid()
    )
  );

CREATE POLICY "Donors update own listings" ON public.food_listings
  FOR UPDATE TO authenticated
  USING (donor_id = auth.uid() OR public.is_admin())
  WITH CHECK (donor_id = auth.uid() OR public.is_admin());

CREATE POLICY "Donors delete own listings" ON public.food_listings
  FOR DELETE TO authenticated
  USING (donor_id = auth.uid() OR public.is_admin());

-- Public browse surface: no exact pickup address, coarse coordinates only
CREATE OR REPLACE VIEW public.food_listings_browse AS
  SELECT
    id, donor_id, title, food_type, description, quantity, unit,
    claimed_quantity, diet, allergens, storage, photo_url,
    prepared_at, best_before, city, status, created_at, updated_at,
    round(latitude::numeric, 2)::double precision AS latitude,
    round(longitude::numeric, 2)::double precision AS longitude
  FROM public.food_listings
  WHERE status IN ('posted', 'claimed', 'scheduled');

GRANT SELECT ON public.food_listings_browse TO authenticated;

-- 5. claims / pickups / impact_records ---------------------------------------
DROP POLICY IF EXISTS "Claim parties can view claims" ON public.claims;
DROP POLICY IF EXISTS "Claim parties update claims" ON public.claims;
DROP POLICY IF EXISTS "NGOs delete own claims" ON public.claims;

CREATE POLICY "Claim parties can view claims" ON public.claims
  FOR SELECT TO authenticated
  USING (
    ngo_id = auth.uid() OR public.is_admin()
    OR EXISTS (SELECT 1 FROM public.food_listings l WHERE l.id = claims.listing_id AND l.donor_id = auth.uid())
  );

CREATE POLICY "Claim parties update claims" ON public.claims
  FOR UPDATE TO authenticated
  USING (
    ngo_id = auth.uid() OR public.is_admin()
    OR EXISTS (SELECT 1 FROM public.food_listings l WHERE l.id = claims.listing_id AND l.donor_id = auth.uid())
  )
  WITH CHECK (
    ngo_id = auth.uid() OR public.is_admin()
    OR EXISTS (SELECT 1 FROM public.food_listings l WHERE l.id = claims.listing_id AND l.donor_id = auth.uid())
  );

CREATE POLICY "NGOs delete own claims" ON public.claims
  FOR DELETE TO authenticated
  USING (ngo_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Pickup parties can view pickups" ON public.pickups;
DROP POLICY IF EXISTS "Pickup parties update pickups" ON public.pickups;

CREATE POLICY "Pickup parties can view pickups" ON public.pickups
  FOR SELECT TO authenticated
  USING (
    volunteer_id = auth.uid() OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.claims c JOIN public.food_listings l ON l.id = c.listing_id
      WHERE c.id = pickups.claim_id AND (c.ngo_id = auth.uid() OR l.donor_id = auth.uid())
    )
  );

CREATE POLICY "Pickup parties update pickups" ON public.pickups
  FOR UPDATE TO authenticated
  USING (
    volunteer_id = auth.uid() OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.claims c JOIN public.food_listings l ON l.id = c.listing_id
      WHERE c.id = pickups.claim_id AND (c.ngo_id = auth.uid() OR l.donor_id = auth.uid())
    )
  )
  WITH CHECK (
    volunteer_id = auth.uid() OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.claims c JOIN public.food_listings l ON l.id = c.listing_id
      WHERE c.id = pickups.claim_id AND (c.ngo_id = auth.uid() OR l.donor_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Signed-in users can view impact" ON public.impact_records;
DROP POLICY IF EXISTS "Admins update impact" ON public.impact_records;
DROP POLICY IF EXISTS "Admins delete impact" ON public.impact_records;
DROP POLICY IF EXISTS "Parties record impact" ON public.impact_records;

CREATE POLICY "Involved parties view impact" ON public.impact_records
  FOR SELECT TO authenticated
  USING (donor_id = auth.uid() OR ngo_id = auth.uid() OR public.is_admin());

CREATE POLICY "Parties record impact" ON public.impact_records
  FOR INSERT TO authenticated
  WITH CHECK (donor_id = auth.uid() OR ngo_id = auth.uid() OR public.is_admin());

CREATE POLICY "Admins update impact" ON public.impact_records
  FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Admins delete impact" ON public.impact_records
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- Aggregated, non-identifying community impact
CREATE OR REPLACE VIEW public.impact_public_stats AS
  SELECT
    food_type,
    city,
    count(*)::bigint AS rescues,
    sum(meals_saved) AS meals_saved,
    sum(weight_kg) AS weight_kg,
    sum(co2_avoided_kg) AS co2_avoided_kg,
    max(completed_at) AS last_completed_at
  FROM public.impact_records
  GROUP BY food_type, city;

GRANT SELECT ON public.impact_public_stats TO authenticated;