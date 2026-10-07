BEGIN;
-- Private implementation namespace: PostgREST exposes public, not this schema.
CREATE SCHEMA IF NOT EXISTS feedforward_private;
REVOKE ALL ON SCHEMA feedforward_private FROM PUBLIC, anon, authenticated;

CREATE TABLE public.workflow_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id uuid, entity_table text NOT NULL, entity_id uuid NOT NULL,
 old_status text, new_status text, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workflow_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workflow_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.workflow_audit TO authenticated;
GRANT ALL ON public.workflow_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.workflow_audit_id_seq TO service_role;
CREATE POLICY "Admins read workflow audit" ON public.workflow_audit FOR SELECT TO authenticated USING (public.is_admin());
CREATE INDEX workflow_audit_time ON public.workflow_audit(created_at);
CREATE FUNCTION feedforward_private.audit_workflow() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
   INSERT INTO public.workflow_audit(actor_id,entity_table,entity_id,new_status) VALUES(auth.uid(),TG_TABLE_NAME,NEW.id,NEW.status::text);
 ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
   INSERT INTO public.workflow_audit(actor_id,entity_table,entity_id,old_status,new_status) VALUES(auth.uid(),TG_TABLE_NAME,NEW.id,OLD.status::text,NEW.status::text);
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER audit_listing AFTER INSERT OR UPDATE ON public.food_listings FOR EACH ROW EXECUTE FUNCTION feedforward_private.audit_workflow();
CREATE TRIGGER audit_claim AFTER INSERT OR UPDATE ON public.claims FOR EACH ROW EXECUTE FUNCTION feedforward_private.audit_workflow();
CREATE TRIGGER audit_pickup AFTER INSERT OR UPDATE ON public.pickups FOR EACH ROW EXECUTE FUNCTION feedforward_private.audit_workflow();

CREATE TABLE feedforward_private.rate_windows (
 user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
 action text NOT NULL, window_start timestamptz NOT NULL, count integer NOT NULL,
 PRIMARY KEY(user_id,action,window_start)
);
CREATE FUNCTION feedforward_private.consume_quota(_user uuid, _action text, _limit integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE used integer;
BEGIN
 INSERT INTO feedforward_private.rate_windows AS w(user_id,action,window_start,count)
 VALUES(_user,_action,date_trunc('hour',now()),1)
 ON CONFLICT(user_id,action,window_start) DO UPDATE SET count=w.count+1
 RETURNING count INTO used;
 RETURN used <= _limit;
END; $$;
CREATE FUNCTION public.reserve_photo_upload(_user uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
 SELECT feedforward_private.consume_quota(_user,'photo',20);
$$;
REVOKE ALL ON FUNCTION public.reserve_photo_upload(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_photo_upload(uuid) TO service_role;

CREATE FUNCTION feedforward_private.limit_inserts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF auth.uid() IS NOT NULL AND NOT feedforward_private.consume_quota(auth.uid(),TG_TABLE_NAME,60) THEN
   RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Hourly action limit reached. Try again later.';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER quota_listing BEFORE INSERT ON public.food_listings FOR EACH ROW EXECUTE FUNCTION feedforward_private.limit_inserts();
CREATE TRIGGER quota_claim BEFORE INSERT ON public.claims FOR EACH ROW EXECUTE FUNCTION feedforward_private.limit_inserts();
CREATE TRIGGER quota_pickup BEFORE INSERT ON public.pickups FOR EACH ROW EXECUTE FUNCTION feedforward_private.limit_inserts();
CREATE TRIGGER quota_feedback BEFORE INSERT ON public.delivery_feedback FOR EACH ROW EXECUTE FUNCTION feedforward_private.limit_inserts();

CREATE TABLE public.food_photos (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
 object_path text NOT NULL UNIQUE, public_url text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.food_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.food_photos FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.food_photos TO service_role;
GRANT SELECT ON public.food_photos TO authenticated;
CREATE POLICY "Owners view uploaded photos" ON public.food_photos FOR SELECT TO authenticated USING(owner_id=auth.uid() OR public.is_admin());

-- Public food-only images. Only the server uploads decoded, re-encoded JPEGs.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('food-photos','food-photos',true,5242880,ARRAY['image/jpeg'])
ON CONFLICT(id) DO UPDATE SET public=true,file_size_limit=5242880,allowed_mime_types=ARRAY['image/jpeg'];
-- Restrictive policy prevents an existing broad Storage policy from allowing
-- direct writes into this server-managed bucket. Public image reads use Storage.
CREATE POLICY "Food photos server managed" ON storage.objects AS RESTRICTIVE
FOR ALL TO authenticated USING(bucket_id <> 'food-photos') WITH CHECK(bucket_id <> 'food-photos');
CREATE FUNCTION feedforward_private.check_photo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF NEW.photo_url IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM public.food_photos WHERE owner_id=NEW.donor_id AND public_url=NEW.photo_url
 ) THEN RAISE EXCEPTION 'Upload a food photo before attaching it'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER check_food_photo BEFORE INSERT ON public.food_listings FOR EACH ROW EXECUTE FUNCTION feedforward_private.check_photo();

-- Normalize finite numeric bounds at the database boundary for direct REST clients.
ALTER TABLE public.food_listings ADD CONSTRAINT listing_values_valid CHECK (
 quantity > 0 AND quantity <= 100000 AND unit IN ('kg','servings') AND
 char_length(title) BETWEEN 3 AND 140 AND char_length(pickup_address) BETWEEN 4 AND 300 AND
 (latitude IS NULL OR latitude BETWEEN -90 AND 90) AND
 (longitude IS NULL OR longitude BETWEEN -180 AND 180)
) NOT VALID;
ALTER TABLE public.profiles ADD CONSTRAINT profile_coordinates_valid CHECK (
 (latitude IS NULL OR latitude BETWEEN -90 AND 90) AND
 (longitude IS NULL OR longitude BETWEEN -180 AND 180) AND service_radius_km BETWEEN 1 AND 200
) NOT VALID;

-- One listing lock is acquired FIRST by every workflow. Underlying RPCs can then
-- take claim/pickup locks without cross-workflow lock-order inversions.
CREATE FUNCTION feedforward_private.reconcile_listing(_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 UPDATE public.food_listings l SET status = CASE
   WHEN l.status IN ('expired','cancelled') THEN l.status
   WHEN l.best_before <= now() THEN 'expired'::public.listing_status
   WHEN l.claimed_quantity < l.quantity THEN CASE WHEN l.claimed_quantity > 0 THEN 'claimed'::public.listing_status ELSE 'posted'::public.listing_status END
   WHEN EXISTS(SELECT 1 FROM public.claims c WHERE c.listing_id=l.id AND c.status IN ('pending','confirmed','scheduled','picked_up','delivered')) THEN 'claimed'::public.listing_status
   WHEN EXISTS(SELECT 1 FROM public.pickups p JOIN public.claims c ON c.id=p.claim_id WHERE c.listing_id=l.id AND p.status='cancelled' AND p.actual_pickup_time IS NOT NULL) THEN 'picked_up'::public.listing_status
   ELSE 'completed'::public.listing_status END
 WHERE l.id=_id;
END; $$;

ALTER FUNCTION public.claim_food_listing(uuid,numeric,text) SET SCHEMA feedforward_private;
REVOKE ALL ON FUNCTION feedforward_private.claim_food_listing(uuid,numeric,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.claim_food_listing(_listing_id uuid, _claimed_quantity numeric, _note text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE listing_id uuid; result uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 listing_id := _listing_id;
 PERFORM 1 FROM public.food_listings WHERE id=listing_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Listing not found'; END IF;
 result := feedforward_private.claim_food_listing(_listing_id, _claimed_quantity, _note);
 PERFORM feedforward_private.reconcile_listing(listing_id);
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.claim_food_listing(uuid,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.claim_food_listing(uuid,numeric,text) TO authenticated;

ALTER FUNCTION public.create_delivery_request(uuid,timestamptz) SET SCHEMA feedforward_private;
REVOKE ALL ON FUNCTION feedforward_private.create_delivery_request(uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.create_delivery_request(_claim_id uuid, _scheduled_time timestamptz) RETURNS TABLE(pickup_id uuid, delivery_pin text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE listing_id uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 listing_id := (SELECT c.listing_id FROM public.claims c WHERE c.id=_claim_id);
 PERFORM 1 FROM public.food_listings WHERE id=listing_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Listing not found'; END IF;
 RETURN QUERY SELECT * FROM feedforward_private.create_delivery_request(_claim_id, _scheduled_time);
 PERFORM feedforward_private.reconcile_listing(listing_id);
 RETURN;
END; $$;
REVOKE ALL ON FUNCTION public.create_delivery_request(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_delivery_request(uuid,timestamptz) TO authenticated;

ALTER FUNCTION public.cancel_food_claim(uuid) SET SCHEMA feedforward_private;
REVOKE ALL ON FUNCTION feedforward_private.cancel_food_claim(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.cancel_food_claim(_claim_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE listing_id uuid; result boolean;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 listing_id := (SELECT c.listing_id FROM public.claims c WHERE c.id=_claim_id);
 PERFORM 1 FROM public.food_listings WHERE id=listing_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Listing not found'; END IF;
 result := feedforward_private.cancel_food_claim(_claim_id);
 PERFORM feedforward_private.reconcile_listing(listing_id);
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.cancel_food_claim(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cancel_food_claim(uuid) TO authenticated;

ALTER FUNCTION public.cancel_food_listing(uuid) SET SCHEMA feedforward_private;
REVOKE ALL ON FUNCTION feedforward_private.cancel_food_listing(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.cancel_food_listing(_listing_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE listing_id uuid; result boolean;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 listing_id := _listing_id;
 PERFORM 1 FROM public.food_listings WHERE id=listing_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Listing not found'; END IF;
 result := feedforward_private.cancel_food_listing(_listing_id);
 PERFORM feedforward_private.reconcile_listing(listing_id);
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.cancel_food_listing(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cancel_food_listing(uuid) TO authenticated;

ALTER FUNCTION public.accept_delivery_request(uuid) SET SCHEMA feedforward_private;
REVOKE ALL ON FUNCTION feedforward_private.accept_delivery_request(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.accept_delivery_request(_pickup_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE listing_id uuid; result boolean;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 listing_id := (SELECT c.listing_id FROM public.claims c JOIN public.pickups p ON p.claim_id=c.id WHERE p.id=_pickup_id);
 PERFORM 1 FROM public.food_listings WHERE id=listing_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Listing not found'; END IF;
 result := feedforward_private.accept_delivery_request(_pickup_id);
 PERFORM feedforward_private.reconcile_listing(listing_id);
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.accept_delivery_request(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accept_delivery_request(uuid) TO authenticated;

ALTER FUNCTION public.advance_delivery_pickup(uuid,public.pickup_status) SET SCHEMA feedforward_private;
REVOKE ALL ON FUNCTION feedforward_private.advance_delivery_pickup(uuid,public.pickup_status) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.advance_delivery_pickup(_pickup_id uuid, _next_status public.pickup_status) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE listing_id uuid; result boolean;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 listing_id := (SELECT c.listing_id FROM public.claims c JOIN public.pickups p ON p.claim_id=c.id WHERE p.id=_pickup_id);
 PERFORM 1 FROM public.food_listings WHERE id=listing_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Listing not found'; END IF;
 IF _next_status <> 'cancelled' AND EXISTS(SELECT 1 FROM public.food_listings WHERE id=listing_id AND best_before<=now()) THEN RAISE EXCEPTION 'Food has expired'; END IF;
 result := feedforward_private.advance_delivery_pickup(_pickup_id, _next_status);
 PERFORM feedforward_private.reconcile_listing(listing_id);
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.advance_delivery_pickup(uuid,public.pickup_status) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.advance_delivery_pickup(uuid,public.pickup_status) TO authenticated;

ALTER FUNCTION public.verify_delivery_pin(uuid,text) SET SCHEMA feedforward_private;
REVOKE ALL ON FUNCTION feedforward_private.verify_delivery_pin(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.verify_delivery_pin(_pickup_id uuid, _pin text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE listing_id uuid; result boolean;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 listing_id := (SELECT c.listing_id FROM public.claims c JOIN public.pickups p ON p.claim_id=c.id WHERE p.id=_pickup_id);
 PERFORM 1 FROM public.food_listings WHERE id=listing_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Listing not found'; END IF;
 result := feedforward_private.verify_delivery_pin(_pickup_id, _pin);
 PERFORM feedforward_private.reconcile_listing(listing_id);
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.verify_delivery_pin(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.verify_delivery_pin(uuid,text) TO authenticated;

-- Bounded, repeatable worker. Expired collected food stays reserved for manual
-- resolution; only uncollected reservations are released. No row is deleted.
CREATE FUNCTION public.expire_food_batch(_batch integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l record; released numeric; total integer:=0;
BEGIN
 FOR l IN SELECT id FROM public.food_listings
   WHERE best_before<=now() AND status NOT IN ('expired','cancelled','completed')
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
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA feedforward_private FROM PUBLIC,anon,authenticated;
-- Notify matching NGO locations, not every NGO on the platform.
CREATE OR REPLACE FUNCTION public.notify_ngos_about_new_food()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF NEW.status <> 'posted' THEN RETURN NEW; END IF;
 INSERT INTO public.notifications(recipient_id,notification_type,title,message,action_url,entity_id)
 SELECT r.user_id,'new_food','New food donation available',
 left(NEW.title || ' - ' || NEW.quantity || ' ' || NEW.unit || ' available nearby',500),'/listings',NEW.id
 FROM public.user_roles r JOIN public.profiles p ON p.id=r.user_id
 WHERE r.role='ngo' AND (
   (NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL
     AND public.notification_distance_km(p.latitude,p.longitude,NEW.latitude,NEW.longitude)<=p.service_radius_km)
   OR ((NEW.latitude IS NULL OR NEW.longitude IS NULL OR p.latitude IS NULL OR p.longitude IS NULL)
     AND nullif(trim(NEW.city),'') IS NOT NULL AND lower(trim(p.city))=lower(trim(NEW.city)))
 );
 RETURN NEW;
END; $$;
COMMIT;
