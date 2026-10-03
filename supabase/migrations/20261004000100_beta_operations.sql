BEGIN;
-- Manual review does not claim government registration validation.
CREATE TABLE public.verification_requests (
 user_id uuid PRIMARY KEY REFERENCES public.profiles(id),
 details text NOT NULL CHECK(length(trim(details)) BETWEEN 20 AND 3000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 review_note text, reviewed_by uuid REFERENCES auth.users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.verification_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.verification_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.verification_requests TO authenticated;
CREATE POLICY verification_read ON public.verification_requests FOR SELECT TO authenticated USING(user_id=auth.uid() OR public.is_admin());
CREATE FUNCTION public.request_verification(_details text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'donor') OR public.has_role(auth.uid(),'ngo')) THEN RAISE EXCEPTION 'Donor or NGO role required'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=auth.uid() AND NOT verified FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account is already approved'; END IF;
 INSERT INTO public.verification_requests(user_id,details) VALUES(auth.uid(),_details)
 ON CONFLICT(user_id) DO UPDATE SET details=excluded.details,status='pending',review_note=NULL,reviewed_by=NULL,updated_at=now();
 RETURN true;
END; $$;
CREATE FUNCTION public.review_verification(_user_id uuid,_approved boolean,_note text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
 IF length(trim(coalesce(_note,''))) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Enter a review reason'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=_user_id FOR UPDATE;
 UPDATE public.verification_requests SET status=CASE WHEN _approved THEN 'approved' ELSE 'rejected' END,review_note=_note,reviewed_by=auth.uid(),updated_at=now() WHERE user_id=_user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Application not found'; END IF;
 UPDATE public.profiles SET verified=_approved WHERE id=_user_id;
 RETURN true;
END; $$;
-- New donor listings and NGO claims are blocked at the database boundary, including RPC calls.
CREATE FUNCTION feedforward_private.require_approved_participant() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE participant uuid;
BEGIN
 IF TG_TABLE_NAME='food_listings' THEN participant := NEW.donor_id; ELSE participant := NEW.ngo_id; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=participant AND verified) THEN RAISE EXCEPTION 'Administrator approval required before posting or claiming food'; END IF;
 IF TG_TABLE_NAME='claims' THEN
 IF NOT EXISTS(SELECT 1 FROM public.food_listings l JOIN public.profiles p ON p.id=l.donor_id WHERE l.id=NEW.listing_id AND p.verified) THEN RAISE EXCEPTION 'The donor must be approved before this food can be claimed'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER approved_donor BEFORE INSERT ON public.food_listings FOR EACH ROW EXECUTE FUNCTION feedforward_private.require_approved_participant();
CREATE TRIGGER approved_ngo BEFORE INSERT ON public.claims FOR EACH ROW EXECUTE FUNCTION feedforward_private.require_approved_participant();
-- NGO food reviews can be read by that food's donor; rider/donor-authored reviews stay admin-only.
CREATE POLICY donor_reads_ngo_food_feedback ON public.delivery_feedback FOR SELECT TO authenticated
 USING(subject_id=auth.uid() AND subject_role='donor' AND reviewer_role='ngo' AND category='food');
CREATE TABLE public.support_tickets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id),
 subject text NOT NULL CHECK(length(trim(subject)) BETWEEN 3 AND 140),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.support_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),ticket_id uuid NOT NULL REFERENCES public.support_tickets(id),
 author_id uuid NOT NULL REFERENCES auth.users(id),is_staff boolean NOT NULL DEFAULT false,
 body text NOT NULL CHECK(length(trim(body)) BETWEEN 3 AND 3000),created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_tickets,public.support_messages FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.support_tickets,public.support_messages TO authenticated;
CREATE POLICY support_owner ON public.support_tickets FOR SELECT TO authenticated USING(user_id=auth.uid() OR public.is_admin());
CREATE POLICY support_message_owner ON public.support_messages FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.support_tickets t WHERE t.id=ticket_id AND (t.user_id=auth.uid() OR public.is_admin())));
CREATE FUNCTION public.open_support_ticket(_subject text,_body text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 IF (SELECT count(*) FROM public.support_tickets WHERE user_id=auth.uid() AND created_at>now()-interval '1 day')>=10 THEN RAISE EXCEPTION 'Daily support request limit reached'; END IF;
 INSERT INTO public.support_tickets(user_id,subject) VALUES(auth.uid(),_subject) RETURNING id INTO result;
 INSERT INTO public.support_messages(ticket_id,author_id,body) VALUES(result,auth.uid(),_body);
 RETURN result;
END; $$;
CREATE FUNCTION public.reply_support_ticket(_ticket_id uuid,_body text,_status text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.support_tickets%ROWTYPE;
BEGIN
 SELECT * INTO t FROM public.support_tickets WHERE id=_ticket_id FOR UPDATE;
 IF auth.uid() IS NULL OR NOT FOUND OR (t.user_id<>auth.uid() AND NOT public.is_admin()) THEN RAISE EXCEPTION 'Ticket not found'; END IF;
 IF _status IS NOT NULL AND NOT public.is_admin() THEN RAISE EXCEPTION 'Only admins can set ticket status'; END IF;
 IF (SELECT count(*) FROM public.support_messages WHERE ticket_id=t.id AND author_id=auth.uid() AND created_at>now()-interval '1 minute')>=10 THEN RAISE EXCEPTION 'Please wait before sending another reply'; END IF;
 INSERT INTO public.support_messages(ticket_id,author_id,is_staff,body) VALUES(t.id,auth.uid(),public.is_admin(),_body);
 UPDATE public.support_tickets SET status=coalesce(_status,CASE WHEN t.status='resolved' THEN 'open' ELSE t.status END),updated_at=now() WHERE id=t.id;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.request_verification(text),public.review_verification(uuid,boolean,text),public.open_support_ticket(text,text),public.reply_support_ticket(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_verification(text),public.review_verification(uuid,boolean,text),public.open_support_ticket(text,text),public.reply_support_ticket(uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION feedforward_private.require_approved_participant() FROM PUBLIC,anon,authenticated;
COMMIT;
