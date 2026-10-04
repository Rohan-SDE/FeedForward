BEGIN;
ALTER TABLE public.notifications DROP CONSTRAINT notifications_notification_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_notification_type_check CHECK(notification_type IN ('new_food','delivery_request','delivery_accepted','system'));
CREATE TABLE public.account_restrictions (
 user_id uuid PRIMARY KEY REFERENCES public.profiles(id),
 blocked boolean NOT NULL DEFAULT false,
 blocked_until timestamptz,
 reason text NOT NULL,
 updated_by uuid NOT NULL REFERENCES auth.users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.moderation_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES public.profiles(id),
 admin_id uuid NOT NULL REFERENCES auth.users(id),
 action text NOT NULL CHECK(action IN ('warning','block','unblock')),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),
 blocked_until timestamptz,
 feedback_id uuid REFERENCES public.delivery_feedback(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.account_restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_restrictions,public.moderation_actions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.account_restrictions,public.moderation_actions TO authenticated;
GRANT ALL ON public.account_restrictions,public.moderation_actions TO service_role;
CREATE POLICY restriction_read ON public.account_restrictions FOR SELECT TO authenticated USING(user_id=auth.uid() OR public.is_admin());
CREATE POLICY moderation_read ON public.moderation_actions FOR SELECT TO authenticated USING(public.is_admin());
CREATE FUNCTION public.account_is_blocked(_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.account_restrictions WHERE user_id=_user AND blocked AND (blocked_until IS NULL OR blocked_until>now()));
$$;
REVOKE ALL ON FUNCTION public.account_is_blocked(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.account_is_blocked(uuid) TO authenticated,service_role;
CREATE FUNCTION feedforward_private.assert_account_active() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF public.account_is_blocked(auth.uid()) THEN RAISE EXCEPTION 'Your account is blocked. Contact support for help.'; END IF;
END; $$;
REVOKE ALL ON FUNCTION feedforward_private.assert_account_active() FROM PUBLIC,anon,authenticated;
-- Automatic dispatch must not select suspended riders, even with a recent heartbeat.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid,_role public.app_role) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT NOT public.account_is_blocked(_user_id) AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role);
$$;
CREATE OR REPLACE FUNCTION public.has_current_role(_role public.app_role) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.has_role(auth.uid(),_role);
$$;
CREATE FUNCTION public.moderate_account(_user_id uuid,_action text,_reason text,_until timestamptz DEFAULT NULL,_feedback_id uuid DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
 IF _user_id=auth.uid() OR EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role='admin') OR EXISTS(SELECT 1 FROM public.admin_users WHERE user_id=_user_id) THEN RAISE EXCEPTION 'Administrator accounts cannot be moderated here'; END IF;
 IF _action NOT IN ('warning','block','unblock') OR _action IS NULL THEN RAISE EXCEPTION 'Invalid moderation action'; END IF;
 IF length(trim(coalesce(_reason,''))) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Enter an action reason'; END IF;
 IF _until IS NOT NULL AND (_action<>'block' OR _until<=now()) THEN RAISE EXCEPTION 'Choose a future block expiry'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
 IF _feedback_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.delivery_feedback WHERE id=_feedback_id AND subject_id=_user_id) THEN RAISE EXCEPTION 'Feedback does not refer to this user'; END IF;
 IF _action IN ('block','unblock') THEN
 INSERT INTO public.account_restrictions(user_id,blocked,blocked_until,reason,updated_by)
 VALUES(_user_id,_action='block',_until,trim(_reason),auth.uid())
 ON CONFLICT(user_id) DO UPDATE SET blocked=excluded.blocked,blocked_until=excluded.blocked_until,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=now();
 END IF;
 IF _action='block' THEN
 UPDATE public.rider_presence SET available=false WHERE user_id=_user_id;
 DELETE FROM public.delivery_locations WHERE pickup_id IN (SELECT id FROM public.pickups WHERE volunteer_id=_user_id);
 END IF;
 INSERT INTO public.moderation_actions(user_id,admin_id,action,reason,blocked_until,feedback_id) VALUES(_user_id,auth.uid(),_action,trim(_reason),_until,_feedback_id);
 INSERT INTO public.notifications(recipient_id,notification_type,title,message,action_url)
 VALUES(_user_id,'system','Account moderation',_action||': '||trim(_reason),'/support');
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.moderate_account(uuid,text,text,timestamptz,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.moderate_account(uuid,text,text,timestamptz,uuid) TO authenticated;
-- Guard existing public workflow RPC entry points, including SECURITY DEFINER paths
-- that intentionally bypass table RLS. Preserve their existing bodies and grants.
DO $$ DECLARE f record; definition text;
BEGIN
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname=ANY(ARRAY[
 'claim_food_listing','create_delivery_request','cancel_food_claim','cancel_food_listing',
 'accept_delivery_request','advance_delivery_pickup','verify_delivery_pin','submit_delivery_feedback',
 'set_rider_presence','claim_with_delivery','dispatch_my_request','share_delivery_location',
 'stop_delivery_location','read_delivery_location','update_preparation','report_delivery_delay','request_verification'])
 LOOP
 definition:=pg_get_functiondef(f.oid);
 IF definition !~* '\mBEGIN\M' THEN RAISE EXCEPTION 'Expected a PL/pgSQL workflow'; END IF;
 EXECUTE regexp_replace(definition,'\mBEGIN\M','BEGIN PERFORM feedforward_private.assert_account_active();','i');
 END LOOP;
END; $$;
-- Direct table writes and role changes cannot bypass a block. Support remains open for appeals.
CREATE FUNCTION feedforward_private.guard_blocked_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM feedforward_private.assert_account_active();
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION feedforward_private.guard_blocked_write() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['profiles','user_roles','food_listings','claims','pickups','delivery_feedback','rider_presence','delivery_locations','food_photos'] LOOP
 EXECUTE format('CREATE TRIGGER account_active BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION feedforward_private.guard_blocked_write()',t);
 END LOOP;
END; $$;
-- Prevent new claims for food belonging to blocked donors, including automatic clients.
CREATE OR REPLACE FUNCTION feedforward_private.require_approved_participant() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE participant uuid;
BEGIN
 IF TG_TABLE_NAME='food_listings' THEN participant:=NEW.donor_id; ELSE participant:=NEW.ngo_id; END IF;
 IF public.account_is_blocked(participant) THEN RAISE EXCEPTION 'Participant account is blocked'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=participant AND verified) THEN RAISE EXCEPTION 'Administrator approval required before posting or claiming food'; END IF;
 IF TG_TABLE_NAME='claims' THEN
 IF NOT EXISTS(SELECT 1 FROM public.food_listings l JOIN public.profiles p ON p.id=l.donor_id WHERE l.id=NEW.listing_id AND p.verified AND NOT public.account_is_blocked(p.id)) THEN RAISE EXCEPTION 'The donor must be approved and active before this food can be claimed'; END IF;
 END IF;
 RETURN NEW;
END; $$;
COMMIT;
