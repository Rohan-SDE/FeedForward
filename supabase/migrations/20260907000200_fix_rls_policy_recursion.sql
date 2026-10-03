-- Break circular RLS evaluation between food_listings, claims, pickups and profiles.
-- The helper functions run as the migration owner and only return whether the
-- current authenticated user is a legitimate party to a specific record.

CREATE OR REPLACE FUNCTION public.can_access_listing(_listing_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.food_listings l
    LEFT JOIN public.claims c ON c.listing_id = l.id AND c.status <> 'cancelled'
    LEFT JOIN public.pickups p ON p.claim_id = c.id
    WHERE l.id = _listing_id
      AND (
        l.donor_id = auth.uid()
        OR c.ngo_id = auth.uid()
        OR p.volunteer_id = auth.uid()
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_claim(_claim_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.claims c
    JOIN public.food_listings l ON l.id = c.listing_id
    LEFT JOIN public.pickups p ON p.claim_id = c.id
    WHERE c.id = _claim_id
      AND (
        c.ngo_id = auth.uid()
        OR l.donor_id = auth.uid()
        OR p.volunteer_id = auth.uid()
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_pickup(_pickup_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.pickups p
    JOIN public.claims c ON c.id = p.claim_id
    JOIN public.food_listings l ON l.id = c.listing_id
    WHERE p.id = _pickup_id
      AND (
        p.volunteer_id = auth.uid()
        OR c.ngo_id = auth.uid()
        OR l.donor_id = auth.uid()
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_profile(_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _profile_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.claims c
      JOIN public.food_listings l ON l.id = c.listing_id
      LEFT JOIN public.pickups p ON p.claim_id = c.id
      WHERE c.status <> 'cancelled'
        AND (
          (c.ngo_id = auth.uid() AND l.donor_id = _profile_id)
          OR (l.donor_id = auth.uid() AND c.ngo_id = _profile_id)
          OR (
            p.volunteer_id = auth.uid()
            AND _profile_id IN (c.ngo_id, l.donor_id)
          )
          OR (
            _profile_id = p.volunteer_id
            AND auth.uid() IN (c.ngo_id, l.donor_id)
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.can_access_listing(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_claim(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_pickup(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_profile(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_access_listing(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_claim(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_pickup(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_profile(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Involved parties view listings" ON public.food_listings;
CREATE POLICY "Involved parties view listings" ON public.food_listings
  FOR SELECT TO authenticated
  USING (public.is_admin() OR public.can_access_listing(id));

DROP POLICY IF EXISTS "Claim parties can view claims" ON public.claims;
CREATE POLICY "Claim parties can view claims" ON public.claims
  FOR SELECT TO authenticated
  USING (public.is_admin() OR public.can_access_claim(id));

DROP POLICY IF EXISTS "Claim parties update claims" ON public.claims;
CREATE POLICY "Claim parties update claims" ON public.claims
  FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.can_access_claim(id))
  WITH CHECK (public.is_admin() OR public.can_access_claim(id));

DROP POLICY IF EXISTS "Pickup parties create pickups" ON public.pickups;
CREATE POLICY "Pickup parties create pickups" ON public.pickups
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR public.can_access_claim(claim_id));

DROP POLICY IF EXISTS "Pickup parties can view pickups" ON public.pickups;
CREATE POLICY "Pickup parties can view pickups" ON public.pickups
  FOR SELECT TO authenticated
  USING (public.is_admin() OR public.can_access_pickup(id));

DROP POLICY IF EXISTS "Pickup parties update pickups" ON public.pickups;
CREATE POLICY "Pickup parties update pickups" ON public.pickups
  FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.can_access_pickup(id))
  WITH CHECK (public.is_admin() OR public.can_access_pickup(id));

DROP POLICY IF EXISTS "Own admin or related profiles" ON public.profiles;
CREATE POLICY "Own admin or related profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.is_admin() OR public.can_access_profile(id));
