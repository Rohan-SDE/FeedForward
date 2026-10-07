-- Production hardening for the review-critical donor -> NGO claim flow.

-- An account has one operational role. Admin remains a separate privileged role.
WITH ranked_roles AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id
           ORDER BY CASE role
             WHEN 'admin' THEN 0
             WHEN 'donor' THEN 1
             WHEN 'ngo' THEN 2
             WHEN 'volunteer' THEN 3
           END, created_at, id
         ) AS position
  FROM public.user_roles
)
DELETE FROM public.user_roles r
USING ranked_roles ranked
WHERE r.id = ranked.id AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_one_role_per_user
  ON public.user_roles (user_id);

DROP POLICY IF EXISTS "Users pick own non-admin role" ON public.user_roles;
CREATE POLICY "Users choose one own non-admin role" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND role <> 'admin'
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles existing
      WHERE existing.user_id = auth.uid()
    )
  );

-- Safe current-user role predicate. It cannot be used to inspect another user.
CREATE OR REPLACE FUNCTION public.has_current_role(_role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = _role
  );
$$;

REVOKE ALL ON FUNCTION public.has_current_role(public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_current_role(public.app_role) TO authenticated, service_role;

-- Enforce the business roles at the database boundary, not only in navigation.
DROP POLICY IF EXISTS "Donors create own listings" ON public.food_listings;
CREATE POLICY "Only donors create own listings" ON public.food_listings
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = donor_id
    AND (public.has_current_role('donor') OR public.is_admin())
  );

DROP POLICY IF EXISTS "NGOs create own claims" ON public.claims;
CREATE POLICY "Only NGOs create own claims" ON public.claims
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = ngo_id AND public.has_current_role('ngo'));

-- New writes must have a valid food-safety window and valid claimed total.
ALTER TABLE public.food_listings
  ADD CONSTRAINT food_listings_safe_window
  CHECK (best_before > prepared_at) NOT VALID;

ALTER TABLE public.food_listings
  ADD CONSTRAINT food_listings_claimed_quantity_bounds
  CHECK (claimed_quantity >= 0 AND claimed_quantity <= quantity) NOT VALID;

-- Claim creation and quantity reservation must be one locked database operation.
-- This removes the read/insert/update race that could over-claim a listing.
CREATE OR REPLACE FUNCTION public.claim_food_listing(
  _listing_id uuid,
  _claimed_quantity numeric,
  _note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  listing public.food_listings%ROWTYPE;
  new_claim_id uuid;
  remaining numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_current_role('ngo') THEN
    RAISE EXCEPTION 'Only NGO accounts can claim food';
  END IF;

  IF _claimed_quantity IS NULL OR _claimed_quantity <= 0 OR _claimed_quantity > 100000 THEN
    RAISE EXCEPTION 'Claimed quantity must be between 0 and 100000';
  END IF;

  IF length(COALESCE(_note, '')) > 400 THEN
    RAISE EXCEPTION 'Claim note is too long';
  END IF;

  SELECT * INTO listing
  FROM public.food_listings
  WHERE id = _listing_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found';
  END IF;

  IF listing.donor_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot claim your own listing';
  END IF;

  IF listing.best_before <= now() THEN
    RAISE EXCEPTION 'This listing is past its best-before window';
  END IF;

  IF listing.status NOT IN ('posted', 'claimed') THEN
    RAISE EXCEPTION 'This listing is no longer open for claims';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.claims
    WHERE listing_id = _listing_id
      AND ngo_id = auth.uid()
      AND status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'Your organisation has already claimed this listing';
  END IF;

  remaining := listing.quantity - listing.claimed_quantity;
  IF _claimed_quantity > remaining THEN
    RAISE EXCEPTION 'Only % left to claim', remaining;
  END IF;

  INSERT INTO public.claims (listing_id, ngo_id, claimed_quantity, note, status)
  VALUES (_listing_id, auth.uid(), _claimed_quantity, NULLIF(trim(_note), ''), 'confirmed')
  RETURNING id INTO new_claim_id;

  UPDATE public.food_listings
  SET claimed_quantity = claimed_quantity + _claimed_quantity,
      status = 'claimed'
  WHERE id = _listing_id;

  RETURN new_claim_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_food_listing(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_food_listing(uuid, numeric, text)
  TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_listings_open_best_before
  ON public.food_listings (best_before)
  WHERE status IN ('posted', 'claimed', 'scheduled');
