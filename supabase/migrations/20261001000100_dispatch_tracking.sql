BEGIN;
CREATE TABLE public.rider_presence (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 available boolean NOT NULL DEFAULT false,
 latitude double precision NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude double precision NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.delivery_locations (
 pickup_id uuid PRIMARY KEY REFERENCES public.pickups(id) ON DELETE CASCADE,
 latitude double precision NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude double precision NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 accuracy double precision NOT NULL CHECK(accuracy BETWEEN 0 AND 10000),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rider_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rider_presence,public.delivery_locations FROM PUBLIC,anon,authenticated;

CREATE FUNCTION feedforward_private.guard_rider_capacity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.volunteer_id IS NULL OR NEW.status NOT IN ('scheduled','en_route','picked_up','delivered') THEN RETURN NEW; END IF;
 PERFORM 1 FROM public.profiles WHERE id=NEW.volunteer_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.pickups WHERE volunteer_id=NEW.volunteer_id AND id<>NEW.id
   AND status IN ('scheduled','en_route','picked_up','delivered')) THEN
   RAISE EXCEPTION 'This rider already has an active delivery';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER rider_capacity BEFORE INSERT OR UPDATE OF volunteer_id,status ON public.pickups
FOR EACH ROW EXECUTE FUNCTION feedforward_private.guard_rider_capacity();

CREATE FUNCTION feedforward_private.dispatch_waiting() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE job record; rider uuid; assigned integer:=0;
BEGIN
 -- Concurrent requests can leave work for the next rider heartbeat instead of waiting.
 IF NOT pg_try_advisory_xact_lock(76124019) THEN RETURN 0; END IF;
 FOR job IN SELECT p.id,c.ngo_id,l.latitude,l.longitude FROM public.pickups p
 JOIN public.claims c ON c.id=p.claim_id JOIN public.food_listings l ON l.id=c.listing_id
 WHERE p.volunteer_id IS NULL AND p.status='scheduled' AND l.best_before>now()
 AND p.scheduled_time<=now()+interval '15 minutes' AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL
 ORDER BY p.created_at LIMIT 50 FOR UPDATE OF p SKIP LOCKED
 LOOP
   rider:=NULL;
   SELECT r.user_id INTO rider FROM public.rider_presence r JOIN public.profiles pr ON pr.id=r.user_id
   WHERE r.available AND r.updated_at>now()-interval '90 seconds'
   AND public.has_role(r.user_id,'volunteer')
   AND NOT EXISTS(SELECT 1 FROM public.pickups active WHERE active.volunteer_id=r.user_id
     AND active.status IN ('scheduled','en_route','picked_up','delivered'))
   AND public.notification_distance_km(r.latitude,r.longitude,job.latitude,job.longitude)<=least(coalesce(pr.service_radius_km,10),50)
   ORDER BY public.notification_distance_km(r.latitude,r.longitude,job.latitude,job.longitude),r.user_id
   LIMIT 1 FOR UPDATE OF pr SKIP LOCKED;
   IF rider IS NOT NULL THEN
     UPDATE public.pickups SET volunteer_id=rider WHERE id=job.id;
     INSERT INTO public.notifications(recipient_id,notification_type,title,message,action_url,entity_id)
     VALUES(rider,'delivery_request','Delivery assigned','A nearby food collection is assigned to you.','/delivery/'||job.id,job.id);
     assigned:=assigned+1;
   END IF;
 END LOOP;
 RETURN assigned;
END; $$;

CREATE FUNCTION public.set_rider_presence(_available boolean,_latitude double precision,_longitude double precision)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'volunteer') THEN RAISE EXCEPTION 'Volunteer account required'; END IF;
 INSERT INTO public.rider_presence(user_id,available,latitude,longitude,updated_at)
 VALUES(auth.uid(),_available,_latitude,_longitude,now())
 ON CONFLICT(user_id) DO UPDATE SET available=excluded.available,latitude=excluded.latitude,longitude=excluded.longitude,updated_at=now();
 IF _available THEN PERFORM feedforward_private.dispatch_waiting(); END IF;
 RETURN true;
END; $$;

CREATE FUNCTION public.claim_with_delivery(_listing_id uuid,_claimed_quantity numeric,_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE claim_id uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND latitude IS NOT NULL AND longitude IS NOT NULL) THEN
 RAISE EXCEPTION 'Save your NGO location in Profile before requesting delivery'; END IF;
 claim_id:=public.claim_food_listing(_listing_id,_claimed_quantity,_note);
 PERFORM public.create_delivery_request(claim_id,now());
 PERFORM feedforward_private.dispatch_waiting();
 RETURN claim_id;
END; $$;

CREATE FUNCTION public.dispatch_my_request(_pickup_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.pickups p JOIN public.claims c ON c.id=p.claim_id WHERE p.id=_pickup_id AND c.ngo_id=auth.uid()) THEN
 RAISE EXCEPTION 'Delivery not found'; END IF;
 PERFORM feedforward_private.dispatch_waiting();
 RETURN true;
END; $$;

CREATE FUNCTION public.share_delivery_location(_pickup_id uuid,_latitude double precision,_longitude double precision,_accuracy double precision)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM public.pickups WHERE id=_pickup_id AND volunteer_id=auth.uid()
 AND status IN ('scheduled','en_route','picked_up','delivered') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active assigned delivery required'; END IF;
 INSERT INTO public.delivery_locations(pickup_id,latitude,longitude,accuracy) VALUES(_pickup_id,_latitude,_longitude,_accuracy)
 ON CONFLICT(pickup_id) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude,accuracy=excluded.accuracy,updated_at=now();
 RETURN true;
END; $$;
CREATE FUNCTION public.stop_delivery_location(_pickup_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM public.pickups WHERE id=_pickup_id AND volunteer_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Assigned delivery required'; END IF;
 DELETE FROM public.delivery_locations WHERE pickup_id=_pickup_id;
 RETURN true;
END; $$;
CREATE FUNCTION public.read_delivery_location(_pickup_id uuid)
RETURNS TABLE(latitude double precision,longitude double precision,accuracy double precision,updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.pickups p JOIN public.claims c ON c.id=p.claim_id WHERE p.id=_pickup_id
 AND (c.ngo_id=auth.uid() OR p.volunteer_id=auth.uid())) THEN RAISE EXCEPTION 'Delivery not found'; END IF;
 RETURN QUERY SELECT d.latitude,d.longitude,d.accuracy,d.updated_at FROM public.delivery_locations d
 JOIN public.pickups p ON p.id=d.pickup_id WHERE p.id=_pickup_id
 AND p.status IN ('scheduled','en_route','picked_up','delivered') AND d.updated_at>now()-interval '5 minutes';
END; $$;
CREATE FUNCTION feedforward_private.clear_delivery_location() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.status IN ('completed','cancelled') THEN DELETE FROM public.delivery_locations WHERE pickup_id=NEW.id; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER clear_delivery_location AFTER UPDATE OF status ON public.pickups
FOR EACH ROW EXECUTE FUNCTION feedforward_private.clear_delivery_location();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA feedforward_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.set_rider_presence(boolean,double precision,double precision),public.claim_with_delivery(uuid,numeric,text),public.dispatch_my_request(uuid),public.share_delivery_location(uuid,double precision,double precision,double precision),public.stop_delivery_location(uuid),public.read_delivery_location(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_rider_presence(boolean,double precision,double precision),public.claim_with_delivery(uuid,numeric,text),public.dispatch_my_request(uuid),public.share_delivery_location(uuid,double precision,double precision,double precision),public.stop_delivery_location(uuid),public.read_delivery_location(uuid) TO authenticated;
COMMIT;
