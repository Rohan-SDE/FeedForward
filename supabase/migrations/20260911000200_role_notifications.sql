-- Durable in-app notifications for the donor -> NGO -> delivery partner flow.
-- Recipients can read their own notifications and may only update read_at.

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_type text NOT NULL CHECK (
    notification_type IN ('new_food', 'delivery_request', 'delivery_accepted')
  ),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 500),
  action_url text NOT NULL DEFAULT '/dashboard' CHECK (action_url ~ '^/[A-Za-z0-9_./-]*$'),
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications"
ON public.notifications FOR SELECT TO authenticated
USING (recipient_id = auth.uid());

DROP POLICY IF EXISTS "Users mark own notifications read" ON public.notifications;
CREATE POLICY "Users mark own notifications read"
ON public.notifications FOR UPDATE TO authenticated
USING (recipient_id = auth.uid())
WITH CHECK (recipient_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created
ON public.notifications(recipient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
ON public.notifications(recipient_id, created_at DESC)
WHERE read_at IS NULL;

CREATE OR REPLACE FUNCTION public.notification_distance_km(
  first_lat double precision,
  first_lng double precision,
  second_lat double precision,
  second_lng double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT 6371 * 2 * asin(sqrt(least(1, greatest(0,
    power(sin(radians((second_lat - first_lat) / 2)), 2)
    + cos(radians(first_lat)) * cos(radians(second_lat))
      * power(sin(radians((second_lng - first_lng) / 2)), 2)
  ))));
$$;

CREATE OR REPLACE FUNCTION public.notify_ngos_about_new_food()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> 'posted' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (
    recipient_id, notification_type, title, message, action_url, entity_id
  )
  SELECT
    roles.user_id,
    'new_food',
    'New food donation available',
    left(NEW.title || ' - ' || NEW.quantity || ' ' || NEW.unit || ' available in '
      || coalesce(nullif(NEW.city, ''), 'your area'), 500),
    '/listings',
    NEW.id
  FROM public.user_roles AS roles
  WHERE roles.role = 'ngo';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_ngos_new_food ON public.food_listings;
CREATE TRIGGER trg_notify_ngos_new_food
AFTER INSERT ON public.food_listings
FOR EACH ROW EXECUTE FUNCTION public.notify_ngos_about_new_food();

CREATE OR REPLACE FUNCTION public.notify_nearby_delivery_partners()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  delivery record;
BEGIN
  IF NEW.status <> 'scheduled' OR NEW.volunteer_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    listing.title,
    listing.city,
    listing.latitude,
    listing.longitude,
    claim.claimed_quantity,
    listing.unit
  INTO delivery
  FROM public.claims AS claim
  JOIN public.food_listings AS listing ON listing.id = claim.listing_id
  WHERE claim.id = NEW.claim_id;

  IF NOT FOUND OR delivery.latitude IS NULL OR delivery.longitude IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (
    recipient_id, notification_type, title, message, action_url, entity_id
  )
  SELECT
    roles.user_id,
    'delivery_request',
    'New delivery request nearby',
    left(delivery.title || ' - collect ' || delivery.claimed_quantity || ' '
      || delivery.unit || ' from ' || coalesce(nullif(delivery.city, ''), 'the nearby donor'), 500),
    '/dashboard',
    NEW.id
  FROM public.user_roles AS roles
  JOIN public.profiles AS profile ON profile.id = roles.user_id
  WHERE roles.role = 'volunteer'
    AND profile.latitude IS NOT NULL
    AND profile.longitude IS NOT NULL
    AND public.notification_distance_km(
      profile.latitude,
      profile.longitude,
      delivery.latitude,
      delivery.longitude
    ) <= least(greatest(profile.service_radius_km::double precision, 1), 50);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_delivery_partners ON public.pickups;
CREATE TRIGGER trg_notify_delivery_partners
AFTER INSERT ON public.pickups
FOR EACH ROW EXECUTE FUNCTION public.notify_nearby_delivery_partners();

CREATE OR REPLACE FUNCTION public.notify_ngo_delivery_accepted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  receiving_ngo uuid;
  listing_title text;
BEGIN
  IF OLD.volunteer_id IS NOT NULL OR NEW.volunteer_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT claim.ngo_id, listing.title
  INTO receiving_ngo, listing_title
  FROM public.claims AS claim
  JOIN public.food_listings AS listing ON listing.id = claim.listing_id
  WHERE claim.id = NEW.claim_id;

  IF receiving_ngo IS NOT NULL THEN
    INSERT INTO public.notifications (
      recipient_id, notification_type, title, message, action_url, entity_id
    ) VALUES (
      receiving_ngo,
      'delivery_accepted',
      'Delivery partner assigned',
      left('A delivery partner accepted the request for ' || listing_title, 500),
      '/pickups',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_ngo_delivery_accepted ON public.pickups;
CREATE TRIGGER trg_notify_ngo_delivery_accepted
AFTER UPDATE OF volunteer_id ON public.pickups
FOR EACH ROW EXECUTE FUNCTION public.notify_ngo_delivery_accepted();

REVOKE ALL ON FUNCTION public.notification_distance_km(
  double precision, double precision, double precision, double precision
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_ngos_about_new_food() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_nearby_delivery_partners() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_ngo_delivery_accepted() FROM PUBLIC, anon, authenticated;
