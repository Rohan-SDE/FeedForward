-- INSERT ... RETURNING applies the SELECT policy before a helper query can see
-- the statement's newly inserted row. Keep the direct owner/party predicates
-- alongside the non-recursive helpers so legitimate inserts can return data.

DROP POLICY IF EXISTS "Involved parties view listings" ON public.food_listings;
CREATE POLICY "Involved parties view listings" ON public.food_listings
  FOR SELECT TO authenticated
  USING (
    donor_id = auth.uid()
    OR public.is_admin()
    OR public.can_access_listing(id)
  );

DROP POLICY IF EXISTS "Claim parties can view claims" ON public.claims;
CREATE POLICY "Claim parties can view claims" ON public.claims
  FOR SELECT TO authenticated
  USING (
    ngo_id = auth.uid()
    OR public.is_admin()
    OR public.can_access_claim(id)
  );

DROP POLICY IF EXISTS "Pickup parties can view pickups" ON public.pickups;
CREATE POLICY "Pickup parties can view pickups" ON public.pickups
  FOR SELECT TO authenticated
  USING (
    volunteer_id = auth.uid()
    OR public.is_admin()
    OR public.can_access_pickup(id)
  );

DROP POLICY IF EXISTS "Own admin or related profiles" ON public.profiles;
CREATE POLICY "Own admin or related profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.is_admin()
    OR public.can_access_profile(id)
  );
