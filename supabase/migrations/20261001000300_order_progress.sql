-- Preparation is independent from delivery and never extends food expiry.
ALTER TABLE public.food_listings ADD COLUMN preparation_status text NOT NULL DEFAULT 'preparing'
 CHECK (preparation_status IN ('preparing','ready','delayed'));
ALTER TABLE public.food_listings ADD COLUMN preparation_updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.pickups ADD COLUMN delay_note text;
ALTER TABLE public.pickups ADD COLUMN delay_updated_at timestamptz;
CREATE FUNCTION public.update_preparation(_listing_id uuid, _status text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE l public.food_listings%ROWTYPE;
BEGIN
 SELECT * INTO l FROM public.food_listings WHERE id=_listing_id FOR UPDATE;
 IF auth.uid() IS NULL OR NOT FOUND OR l.donor_id IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'Listing not found'; END IF;
 IF l.status IN ('expired','cancelled','completed') OR l.best_before<=now() THEN
  RAISE EXCEPTION 'This listing is no longer active'; END IF;
 IF _status IS NULL OR _status NOT IN ('preparing','ready','delayed') THEN
  RAISE EXCEPTION 'Invalid preparation status'; END IF;
 UPDATE public.food_listings SET preparation_status=_status,preparation_updated_at=now() WHERE id=l.id;
 RETURN true;
END; $$;
CREATE FUNCTION public.report_delivery_delay(_pickup_id uuid, _note text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.pickups%ROWTYPE;
BEGIN
 SELECT * INTO p FROM public.pickups WHERE id=_pickup_id FOR UPDATE;
 IF auth.uid() IS NULL OR NOT FOUND OR p.volunteer_id IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'Delivery not found'; END IF;
 IF p.status NOT IN ('scheduled','en_route','picked_up','delivered') THEN
  RAISE EXCEPTION 'Delivery is no longer active'; END IF;
 IF length(_note)>240 THEN RAISE EXCEPTION 'Delay note is too long'; END IF;
 UPDATE public.pickups SET delay_note=nullif(trim(_note),''),delay_updated_at=now() WHERE id=p.id;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.update_preparation(uuid,text),public.report_delivery_delay(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_preparation(uuid,text),public.report_delivery_delay(uuid,text) TO authenticated;
