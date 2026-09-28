-- Role-specific delivery feedback. Feedback content is visible only to admins.

CREATE TYPE public.feedback_category AS ENUM (
  'delivery_partner',
  'food',
  'food_receiver',
  'restaurant'
);

CREATE TABLE public.delivery_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_id uuid NOT NULL REFERENCES public.pickups(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewer_role public.app_role NOT NULL,
  subject_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_role public.app_role NOT NULL,
  category public.feedback_category NOT NULL,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text NOT NULL CHECK (char_length(trim(comment)) BETWEEN 3 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pickup_id, reviewer_id, category)
);

ALTER TABLE public.delivery_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.delivery_feedback FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.delivery_feedback TO authenticated;
GRANT ALL ON public.delivery_feedback TO service_role;

CREATE POLICY "Only admins read delivery feedback"
ON public.delivery_feedback
FOR SELECT TO authenticated
USING (public.is_admin());

CREATE INDEX idx_delivery_feedback_subject ON public.delivery_feedback(subject_id, created_at DESC);
CREATE INDEX idx_delivery_feedback_pickup ON public.delivery_feedback(pickup_id);

CREATE OR REPLACE FUNCTION public.submit_delivery_feedback(
  _pickup_id uuid,
  _category public.feedback_category,
  _rating integer,
  _comment text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  delivery record;
  selected_reviewer_role public.app_role;
  selected_subject_id uuid;
  selected_subject_role public.app_role;
  new_feedback_id uuid;
BEGIN
  IF _rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Rating must be between 1 and 5';
  END IF;
  IF char_length(trim(coalesce(_comment, ''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'Feedback must contain between 3 and 1000 characters';
  END IF;

  SELECT p.id, p.status, p.volunteer_id,
         c.ngo_id,
         l.donor_id
  INTO delivery
  FROM public.pickups p
  JOIN public.claims c ON c.id = p.claim_id
  JOIN public.food_listings l ON l.id = c.listing_id
  WHERE p.id = _pickup_id;

  IF NOT FOUND OR delivery.status <> 'completed' THEN
    RAISE EXCEPTION 'Feedback is available only after a completed delivery';
  END IF;

  IF auth.uid() = delivery.donor_id AND _category = 'delivery_partner' THEN
    selected_reviewer_role := 'donor';
    selected_subject_id := delivery.volunteer_id;
    selected_subject_role := 'volunteer';
  ELSIF auth.uid() = delivery.ngo_id AND _category = 'food' THEN
    selected_reviewer_role := 'ngo';
    selected_subject_id := delivery.donor_id;
    selected_subject_role := 'donor';
  ELSIF auth.uid() = delivery.ngo_id AND _category = 'delivery_partner' THEN
    selected_reviewer_role := 'ngo';
    selected_subject_id := delivery.volunteer_id;
    selected_subject_role := 'volunteer';
  ELSIF auth.uid() = delivery.volunteer_id AND _category = 'food_receiver' THEN
    selected_reviewer_role := 'volunteer';
    selected_subject_id := delivery.ngo_id;
    selected_subject_role := 'ngo';
  ELSIF auth.uid() = delivery.volunteer_id AND _category = 'restaurant' THEN
    selected_reviewer_role := 'volunteer';
    selected_subject_id := delivery.donor_id;
    selected_subject_role := 'donor';
  ELSE
    RAISE EXCEPTION 'This feedback category is not available for your role';
  END IF;

  IF selected_subject_id IS NULL THEN
    RAISE EXCEPTION 'This delivery has no delivery partner to review';
  END IF;

  INSERT INTO public.delivery_feedback (
    pickup_id, reviewer_id, reviewer_role,
    subject_id, subject_role, category, rating, comment
  ) VALUES (
    _pickup_id, auth.uid(), selected_reviewer_role,
    selected_subject_id, selected_subject_role, _category, _rating, trim(_comment)
  )
  RETURNING id INTO new_feedback_id;

  RETURN new_feedback_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'You already submitted this feedback';
END;
$$;

CREATE OR REPLACE FUNCTION public.my_submitted_feedback_keys()
RETURNS TABLE(pickup_id uuid, category public.feedback_category)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f.pickup_id, f.category
  FROM public.delivery_feedback f
  WHERE f.reviewer_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.submit_delivery_feedback(uuid, public.feedback_category, integer, text)
FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_submitted_feedback_keys() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_delivery_feedback(uuid, public.feedback_category, integer, text)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_submitted_feedback_keys() TO authenticated;
