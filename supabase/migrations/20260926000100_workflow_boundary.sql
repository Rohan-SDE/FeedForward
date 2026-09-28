BEGIN;
CREATE OR REPLACE FUNCTION public.advance_delivery_pickup(
  _pickup_id uuid,
  _next_status public.pickup_status
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  delivery record;
  admin_user boolean;
  new_claimed numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  admin_user := public.is_admin();

  SELECT
    p.id,
    p.status,
    p.volunteer_id,
    p.claim_id,
    c.ngo_id,
    c.listing_id,
    c.claimed_quantity,
    l.claimed_quantity AS listing_claimed
  INTO delivery
  FROM public.pickups p
  JOIN public.claims c ON c.id = p.claim_id
  JOIN public.food_listings l ON l.id = c.listing_id
  WHERE p.id = _pickup_id
  FOR UPDATE OF p, c, l;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivery was not found';
  END IF;

  IF _next_status = 'cancelled' THEN
    IF delivery.status IN ('completed', 'cancelled') THEN
      RAISE EXCEPTION 'A completed or cancelled delivery cannot be reopened';
    END IF;
    IF NOT admin_user AND delivery.ngo_id <> auth.uid() THEN
      RAISE EXCEPTION 'Only the receiving NGO or an admin can cancel this delivery';
    END IF;
    IF NOT admin_user AND delivery.status NOT IN ('scheduled', 'en_route') THEN
      RAISE EXCEPTION 'Contact an administrator after food has been collected';
    END IF;

    new_claimed := CASE WHEN delivery.status IN ('picked_up', 'delivered')
      THEN delivery.listing_claimed
      ELSE greatest(0, delivery.listing_claimed - delivery.claimed_quantity) END;
    UPDATE public.pickups SET status = 'cancelled', updated_at = now() WHERE id = _pickup_id;
    UPDATE public.claims SET status = 'cancelled' WHERE id = delivery.claim_id;
    UPDATE public.food_listings
    SET claimed_quantity = new_claimed,
        status = CASE
          WHEN new_claimed > 0 THEN 'claimed'::public.listing_status
          ELSE 'posted'::public.listing_status
        END
    WHERE id = delivery.listing_id;
    RETURN true;
  END IF;

  IF NOT admin_user AND NOT public.has_role(auth.uid(), 'volunteer') THEN
    RAISE EXCEPTION 'Only a delivery partner can update delivery progress';
  END IF;
  IF NOT admin_user AND delivery.volunteer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'This delivery is not assigned to you';
  END IF;

  IF delivery.status = 'scheduled' AND _next_status = 'en_route' THEN
    UPDATE public.pickups SET status = 'en_route', updated_at = now() WHERE id = _pickup_id;
    RETURN true;
  END IF;

  IF delivery.status = 'en_route' AND _next_status = 'picked_up' THEN
    UPDATE public.pickups
    SET status = 'picked_up', actual_pickup_time = now(), updated_at = now()
    WHERE id = _pickup_id;
    UPDATE public.claims SET status = 'picked_up' WHERE id = delivery.claim_id;
    UPDATE public.food_listings SET status = 'picked_up' WHERE id = delivery.listing_id;
    RETURN true;
  END IF;

  IF delivery.status = 'picked_up' THEN
    RAISE EXCEPTION 'Enter the NGO delivery PIN to complete the order';
  END IF;

  RAISE EXCEPTION 'Invalid delivery status transition from % to %', delivery.status, _next_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_delivery_pin(
  _pickup_id uuid,
  _pin text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  delivery record;
  next_attempt integer;
  new_claimed numeric;
  weight numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'volunteer') THEN
    RAISE EXCEPTION 'Volunteer authentication required';
  END IF;
  IF _pin IS NULL OR _pin !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'Enter the 6-digit delivery PIN';
  END IF;

  SELECT p.id, p.volunteer_id, p.status, p.claim_id,
         v.pin_code, v.failed_attempts, v.expires_at, v.verified_at,
         c.ngo_id, c.listing_id, c.claimed_quantity,
         l.donor_id, l.unit, l.food_type, l.city, l.quantity, l.claimed_quantity AS listing_claimed
  INTO delivery
  FROM public.pickups p
  JOIN public.delivery_verifications v ON v.pickup_id = p.id
  JOIN public.claims c ON c.id = p.claim_id
  JOIN public.food_listings l ON l.id = c.listing_id
  WHERE p.id = _pickup_id
  FOR UPDATE OF p, v, c, l;

  IF NOT FOUND OR delivery.volunteer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'This delivery is not assigned to you';
  END IF;
  IF delivery.verified_at IS NOT NULL OR delivery.status = 'completed' THEN
    RETURN true;
  END IF;
  IF delivery.status NOT IN ('picked_up', 'delivered') THEN
    RAISE EXCEPTION 'Mark the food as picked up before entering the delivery PIN';
  END IF;
  IF delivery.failed_attempts >= 5 THEN
    RAISE EXCEPTION 'PIN verification is locked for this delivery';
  END IF;
  IF delivery.expires_at <= now() THEN
    RAISE EXCEPTION 'This delivery PIN has expired';
  END IF;

  IF delivery.pin_code <> _pin THEN
    next_attempt := delivery.failed_attempts + 1;
    UPDATE public.delivery_verifications
    SET failed_attempts = next_attempt
    WHERE pickup_id = _pickup_id;

    IF next_attempt >= 5 THEN
      UPDATE public.pickups SET status = 'cancelled' WHERE id = _pickup_id;
      UPDATE public.claims SET status = 'cancelled' WHERE id = delivery.claim_id;
      -- Retain reserved quantity: collected food is no longer at the donor.
      RETURN false;
    END IF;

    RETURN false;
  END IF;

  UPDATE public.delivery_verifications
  SET verified_at = now()
  WHERE pickup_id = _pickup_id;
  UPDATE public.pickups
  SET status = 'completed', delivered_time = now()
  WHERE id = _pickup_id;
  UPDATE public.claims SET status = 'completed' WHERE id = delivery.claim_id;
  UPDATE public.food_listings
  SET status = CASE WHEN delivery.listing_claimed >= delivery.quantity
                    THEN 'completed'::public.listing_status
                    ELSE 'posted'::public.listing_status END
  WHERE id = delivery.listing_id;

  weight := CASE WHEN delivery.unit = 'kg' THEN delivery.claimed_quantity
                 ELSE delivery.claimed_quantity * 0.4 END;
  INSERT INTO public.impact_records (
    pickup_id, donor_id, ngo_id, city, food_type,
    meals_saved, weight_kg, co2_avoided_kg
  ) VALUES (
    _pickup_id, delivery.donor_id, delivery.ngo_id, delivery.city, delivery.food_type,
    CASE WHEN delivery.unit = 'kg' THEN delivery.claimed_quantity * 2.5
         ELSE delivery.claimed_quantity END,
    round(weight, 1), round(weight * 2.5, 1)
  ) ON CONFLICT (pickup_id) DO NOTHING;

  RETURN true;
END;
$$;


-- Clients must use row-locked RPCs for workflow mutations.
REVOKE INSERT, UPDATE, DELETE ON public.claims, public.pickups, public.impact_records FROM authenticated, anon;
REVOKE UPDATE, DELETE ON public.food_listings FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.cancel_food_claim(_claim_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.claims%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO c FROM public.claims WHERE id = _claim_id FOR UPDATE;
  IF NOT FOUND OR (c.ngo_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Claim not found';
  END IF;
  IF c.status = 'cancelled' THEN RETURN true; END IF;
  IF c.status <> 'confirmed' OR EXISTS (SELECT 1 FROM public.pickups WHERE claim_id = c.id) THEN
    RAISE EXCEPTION 'Use delivery cancellation for scheduled claims';
  END IF;
  UPDATE public.food_listings SET
    claimed_quantity = greatest(0, claimed_quantity - c.claimed_quantity),
    status = CASE WHEN claimed_quantity - c.claimed_quantity > 0 THEN 'claimed'::public.listing_status ELSE 'posted'::public.listing_status END
  WHERE id = c.listing_id;
  UPDATE public.claims SET status = 'cancelled' WHERE id = c.id;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.cancel_food_listing(_listing_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.food_listings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO l FROM public.food_listings WHERE id = _listing_id FOR UPDATE;
  IF NOT FOUND OR (l.donor_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Listing not found';
  END IF;
  IF l.status = 'cancelled' THEN RETURN true; END IF;
  IF l.claimed_quantity > 0 OR l.status <> 'posted' THEN
    RAISE EXCEPTION 'Resolve existing claims before cancelling a listing';
  END IF;
  UPDATE public.food_listings SET status = 'cancelled' WHERE id = l.id;
  RETURN true;
END; $$;

-- RLS alone does not restrict which profile columns an owner changes.
CREATE OR REPLACE FUNCTION public.guard_profile_verification()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND NOT public.is_admin() THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.verified THEN RAISE EXCEPTION 'Only admins can verify organisations'; END IF;
    ELSIF NEW.verified IS DISTINCT FROM OLD.verified THEN
      RAISE EXCEPTION 'Only admins can verify organisations';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER guard_profile_verification BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_verification();
REVOKE ALL ON FUNCTION public.cancel_food_claim(uuid), public.cancel_food_listing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_food_claim(uuid), public.cancel_food_listing(uuid) TO authenticated;
-- Validate direct REST inserts too; browser code cannot be the security boundary.
CREATE OR REPLACE FUNCTION public.guard_new_listing()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.status <> 'posted' OR NEW.claimed_quantity <> 0 THEN
      RAISE EXCEPTION 'New listings must be unclaimed and posted';
    END IF;
    IF NEW.best_before <= now() OR NEW.prepared_at > now() THEN
      RAISE EXCEPTION 'Food must be prepared and within its best-before window';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER guard_new_listing BEFORE INSERT ON public.food_listings
FOR EACH ROW EXECUTE FUNCTION public.guard_new_listing();
COMMIT;
