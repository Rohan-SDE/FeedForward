CREATE OR REPLACE FUNCTION public.expire_food_batch(_batch integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l record; released numeric; total integer:=0;
BEGIN
 FOR l IN SELECT id FROM public.food_listings
   WHERE best_before<=now() AND status NOT IN ('cancelled','completed')
     AND (status <> 'expired' OR EXISTS (
       SELECT 1 FROM public.claims c WHERE c.listing_id=food_listings.id
       AND c.status IN ('pending','confirmed','scheduled')
       AND NOT EXISTS (SELECT 1 FROM public.pickups p WHERE p.claim_id=c.id AND p.actual_pickup_time IS NOT NULL)
     ))
   ORDER BY id LIMIT least(greatest(_batch,1),500) FOR UPDATE SKIP LOCKED
 LOOP
   SELECT coalesce(sum(c.claimed_quantity),0) INTO released FROM public.claims c
   WHERE c.listing_id=l.id AND c.status IN ('pending','confirmed','scheduled')
     AND NOT EXISTS(SELECT 1 FROM public.pickups p WHERE p.claim_id=c.id AND p.actual_pickup_time IS NOT NULL);
   UPDATE public.pickups p SET status='cancelled' FROM public.claims c
   WHERE p.claim_id=c.id AND c.listing_id=l.id AND p.status IN ('scheduled','en_route') AND p.actual_pickup_time IS NULL;
   UPDATE public.claims c SET status='cancelled' WHERE c.listing_id=l.id AND c.status IN ('pending','confirmed','scheduled')
     AND NOT EXISTS(SELECT 1 FROM public.pickups p WHERE p.claim_id=c.id AND p.actual_pickup_time IS NOT NULL);
   UPDATE public.food_listings SET status='expired',claimed_quantity=greatest(0,claimed_quantity-released) WHERE id=l.id;
   total:=total+1;
 END LOOP;
 DELETE FROM feedforward_private.rate_windows WHERE window_start<now()-interval '2 days';
 RETURN total;
END; $$;
REVOKE ALL ON FUNCTION public.expire_food_batch(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.expire_food_batch(integer) TO service_role;

-- Owner cancellation releases only reservations that have not been collected.
CREATE OR REPLACE FUNCTION feedforward_private.cancel_food_listing(_listing_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.food_listings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO l FROM public.food_listings WHERE id=_listing_id FOR UPDATE;
  IF NOT FOUND OR (l.donor_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Listing not found';
  END IF;
  IF l.status='cancelled' THEN RETURN true; END IF;
  IF l.status='completed' OR EXISTS (
    SELECT 1 FROM public.pickups p JOIN public.claims c ON c.id=p.claim_id
    WHERE c.listing_id=l.id AND (p.actual_pickup_time IS NOT NULL OR p.status IN ('picked_up','delivered','completed'))
  ) THEN RAISE EXCEPTION 'Collected food cannot be cancelled; contact support'; END IF;
  UPDATE public.pickups p SET status='cancelled' FROM public.claims c
    WHERE p.claim_id=c.id AND c.listing_id=l.id AND p.status IN ('scheduled','en_route');
  UPDATE public.claims SET status='cancelled' WHERE listing_id=l.id AND status IN ('pending','confirmed','scheduled');
  UPDATE public.food_listings SET status='cancelled', claimed_quantity=0 WHERE id=l.id;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION feedforward_private.cancel_food_listing(uuid) FROM PUBLIC,anon,authenticated,service_role;
-- Repair existing expired reservations immediately when this migration is applied.
SELECT public.expire_food_batch(500);
