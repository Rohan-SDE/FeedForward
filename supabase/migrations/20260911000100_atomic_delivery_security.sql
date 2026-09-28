-- Production hardening for delivery state changes and delivery PIN generation.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.create_delivery_request(
  _claim_id uuid,
  _scheduled_time timestamptz
)
RETURNS TABLE(pickup_id uuid, delivery_pin text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  claim_row record;
  new_pickup_id uuid;
  new_pin text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.has_role(auth.uid(), 'ngo') AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only NGO accounts can request a delivery';
  END IF;

  SELECT c.id, c.ngo_id, c.status, c.listing_id, l.best_before
  INTO claim_row
  FROM public.claims c
  JOIN public.food_listings l ON l.id = c.listing_id
  WHERE c.id = _claim_id
  FOR UPDATE OF c, l;

  IF NOT FOUND OR (claim_row.ngo_id <> auth.uid() AND NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Claim not found';
  END IF;
  IF claim_row.status <> 'confirmed' THEN
    RAISE EXCEPTION 'This claim is not awaiting delivery';
  END IF;
  IF _scheduled_time < now() - interval '5 minutes' THEN
    RAISE EXCEPTION 'Pickup time cannot be in the past';
  END IF;
  IF _scheduled_time >= claim_row.best_before THEN
    RAISE EXCEPTION 'Pickup must be scheduled before the food best-before time';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pickups p WHERE p.claim_id = _claim_id) THEN
    RAISE EXCEPTION 'A delivery request already exists for this claim';
  END IF;

  -- pgcrypto provides stronger randomness than PostgreSQL random().
  new_pin := lpad(
    ((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text,
    6,
    '0'
  );

  INSERT INTO public.pickups (claim_id, scheduled_time, volunteer_id, status)
  VALUES (_claim_id, _scheduled_time, NULL, 'scheduled')
  RETURNING id INTO new_pickup_id;

  INSERT INTO public.delivery_verifications (pickup_id, ngo_id, pin_code, expires_at)
  VALUES (new_pickup_id, claim_row.ngo_id, new_pin, claim_row.best_before);

  UPDATE public.claims SET status = 'scheduled' WHERE id = _claim_id;
  UPDATE public.food_listings SET status = 'scheduled' WHERE id = claim_row.listing_id;

  RETURN QUERY SELECT new_pickup_id, new_pin;
END;
$$;

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

    new_claimed := greatest(0, delivery.listing_claimed - delivery.claimed_quantity);
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
  IF NOT admin_user AND delivery.volunteer_id <> auth.uid() THEN
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

REVOKE ALL ON FUNCTION public.create_delivery_request(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.advance_delivery_pickup(uuid, public.pickup_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_delivery_request(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.advance_delivery_pickup(uuid, public.pickup_status) TO authenticated;
