-- Nearby volunteer delivery marketplace and NGO delivery-PIN verification.
-- Delivery partners never receive the PIN through an API response or table policy.

CREATE TABLE IF NOT EXISTS public.delivery_verifications (
  pickup_id uuid PRIMARY KEY REFERENCES public.pickups(id) ON DELETE CASCADE,
  ngo_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pin_code text NOT NULL CHECK (pin_code ~ '^[0-9]{6}$'),
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.delivery_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.delivery_verifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.delivery_verifications TO authenticated;
GRANT ALL ON public.delivery_verifications TO service_role;

DROP POLICY IF EXISTS "NGOs read their delivery PINs" ON public.delivery_verifications;
CREATE POLICY "NGOs read their delivery PINs"
ON public.delivery_verifications
FOR SELECT TO authenticated
USING (ngo_id = auth.uid() OR public.is_admin());

CREATE UNIQUE INDEX IF NOT EXISTS idx_impact_records_pickup_unique
ON public.impact_records(pickup_id);

-- Keep active demo data usable after this migration. Previously-created pickups
-- receive a PIN that only their NGO can read.
INSERT INTO public.delivery_verifications (pickup_id, ngo_id, pin_code, expires_at)
SELECT
  p.id,
  c.ngo_id,
  lpad(floor(random() * 1000000)::integer::text, 6, '0'),
  l.best_before
FROM public.pickups p
JOIN public.claims c ON c.id = p.claim_id
JOIN public.food_listings l ON l.id = c.listing_id
WHERE p.status IN ('scheduled', 'en_route', 'picked_up', 'delivered')
ON CONFLICT (pickup_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_delivery_request(
  _claim_id uuid,
  _scheduled_time timestamptz
)
RETURNS TABLE(pickup_id uuid, delivery_pin text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claim_row record;
  new_pickup_id uuid;
  new_pin text;
BEGIN
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

  new_pin := lpad(floor(random() * 1000000)::integer::text, 6, '0');

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

CREATE OR REPLACE FUNCTION public.accept_delivery_request(_pickup_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  volunteer record;
  request_row record;
  distance_km double precision;
BEGIN
  IF NOT public.has_role(auth.uid(), 'volunteer') THEN
    RAISE EXCEPTION 'Only volunteer delivery partners can accept requests';
  END IF;

  SELECT latitude, longitude, service_radius_km
  INTO volunteer
  FROM public.profiles
  WHERE id = auth.uid();

  IF volunteer.latitude IS NULL OR volunteer.longitude IS NULL THEN
    RAISE EXCEPTION 'Add your current location in Profile before accepting deliveries';
  END IF;

  SELECT p.id, p.volunteer_id, p.status, p.scheduled_time,
         l.latitude, l.longitude, l.best_before
  INTO request_row
  FROM public.pickups p
  JOIN public.claims c ON c.id = p.claim_id
  JOIN public.food_listings l ON l.id = c.listing_id
  WHERE p.id = _pickup_id
  FOR UPDATE OF p;

  IF NOT FOUND OR request_row.volunteer_id IS NOT NULL OR request_row.status <> 'scheduled' THEN
    RAISE EXCEPTION 'This delivery request has already been accepted';
  END IF;
  IF request_row.best_before <= now() THEN
    RAISE EXCEPTION 'This food has passed its safe collection time';
  END IF;
  IF request_row.latitude IS NULL OR request_row.longitude IS NULL THEN
    RAISE EXCEPTION 'The donor has not provided a pickup location';
  END IF;

  distance_km := 6371 * acos(least(1, greatest(-1,
    cos(radians(volunteer.latitude)) * cos(radians(request_row.latitude))
      * cos(radians(request_row.longitude) - radians(volunteer.longitude))
      + sin(radians(volunteer.latitude)) * sin(radians(request_row.latitude))
  )));

  IF distance_km > least(greatest(volunteer.service_radius_km::double precision, 1), 50) THEN
    RAISE EXCEPTION 'This delivery is outside your service radius';
  END IF;

  UPDATE public.pickups
  SET volunteer_id = auth.uid(), updated_at = now()
  WHERE id = _pickup_id AND volunteer_id IS NULL AND status = 'scheduled';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Another delivery partner accepted this request first';
  END IF;

  RETURN true;
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

  IF NOT FOUND OR delivery.volunteer_id <> auth.uid() THEN
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
      new_claimed := greatest(0, delivery.listing_claimed - delivery.claimed_quantity);
      UPDATE public.pickups SET status = 'cancelled' WHERE id = _pickup_id;
      UPDATE public.claims SET status = 'cancelled' WHERE id = delivery.claim_id;
      UPDATE public.food_listings
      SET claimed_quantity = new_claimed,
          status = CASE WHEN new_claimed > 0 THEN 'claimed'::public.listing_status
                        ELSE 'posted'::public.listing_status END
      WHERE id = delivery.listing_id;
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

REVOKE ALL ON FUNCTION public.create_delivery_request(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_delivery_request(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_delivery_pin(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_delivery_request(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_delivery_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_delivery_pin(uuid, text) TO authenticated;
