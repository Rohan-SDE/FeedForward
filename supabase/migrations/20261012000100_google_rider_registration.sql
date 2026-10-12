-- Enforce rider registration for every insertion route, including signup metadata
-- and direct PostgREST calls. raw_app_meta_data is managed by Supabase Auth.
CREATE OR REPLACE FUNCTION public.require_google_rider_registration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'volunteer' AND NOT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = NEW.user_id
      AND (
        u.raw_app_meta_data->>'provider' = 'google'
        OR COALESCE(u.raw_app_meta_data->'providers', '[]'::jsonb) ? 'google'
      )
  ) THEN
    RAISE EXCEPTION 'Riders must create their account with Google.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER require_google_rider_registration
BEFORE INSERT OR UPDATE OF role, user_id ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.require_google_rider_registration();
