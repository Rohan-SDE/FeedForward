-- Roles enum
CREATE TYPE public.app_role AS ENUM ('donor', 'ngo', 'volunteer', 'admin');
CREATE TYPE public.listing_status AS ENUM ('posted', 'claimed', 'scheduled', 'picked_up', 'delivered', 'completed', 'expired', 'cancelled');
CREATE TYPE public.claim_status AS ENUM ('pending', 'confirmed', 'scheduled', 'picked_up', 'delivered', 'completed', 'cancelled');
CREATE TYPE public.pickup_status AS ENUM ('scheduled', 'en_route', 'picked_up', 'delivered', 'completed', 'cancelled');
CREATE TYPE public.diet_tag AS ENUM ('veg', 'non_veg', 'vegan', 'mixed');
CREATE TYPE public.storage_temp AS ENUM ('hot', 'refrigerated', 'frozen', 'room_temp');

-- Shared updated_at trigger fn
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  org_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  service_radius_km NUMERIC NOT NULL DEFAULT 10,
  food_preferences TEXT[] NOT NULL DEFAULT '{}',
  verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- USER ROLES
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT, INSERT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- FOOD LISTINGS
CREATE TABLE public.food_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  title TEXT NOT NULL,
  food_type TEXT NOT NULL,
  description TEXT,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL DEFAULT 'servings',
  claimed_quantity NUMERIC NOT NULL DEFAULT 0,
  diet public.diet_tag NOT NULL DEFAULT 'veg',
  allergens TEXT,
  storage public.storage_temp NOT NULL DEFAULT 'room_temp',
  photo_url TEXT,
  prepared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  best_before TIMESTAMPTZ NOT NULL,
  pickup_address TEXT NOT NULL,
  city TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  status public.listing_status NOT NULL DEFAULT 'posted',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_listings TO authenticated;
GRANT ALL ON public.food_listings TO service_role;
ALTER TABLE public.food_listings ENABLE ROW LEVEL SECURITY;

-- CLAIMS
CREATE TABLE public.claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.food_listings ON DELETE CASCADE,
  ngo_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  claimed_quantity NUMERIC NOT NULL CHECK (claimed_quantity > 0),
  note TEXT,
  status public.claim_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.claims TO authenticated;
GRANT ALL ON public.claims TO service_role;
ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;

-- PICKUPS
CREATE TABLE public.pickups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES public.claims ON DELETE CASCADE,
  scheduled_time TIMESTAMPTZ NOT NULL,
  actual_pickup_time TIMESTAMPTZ,
  delivered_time TIMESTAMPTZ,
  volunteer_id UUID REFERENCES auth.users ON DELETE SET NULL,
  status public.pickup_status NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pickups TO authenticated;
GRANT ALL ON public.pickups TO service_role;
ALTER TABLE public.pickups ENABLE ROW LEVEL SECURITY;

-- IMPACT RECORDS
CREATE TABLE public.impact_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_id UUID NOT NULL REFERENCES public.pickups ON DELETE CASCADE,
  donor_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  ngo_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  city TEXT,
  food_type TEXT,
  meals_saved NUMERIC NOT NULL DEFAULT 0,
  weight_kg NUMERIC NOT NULL DEFAULT 0,
  co2_avoided_kg NUMERIC NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.impact_records TO authenticated;
GRANT ALL ON public.impact_records TO service_role;
ALTER TABLE public.impact_records ENABLE ROW LEVEL SECURITY;

-- POLICIES: profiles
CREATE POLICY "Signed-in users can view profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Admins update any profile" ON public.profiles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- POLICIES: user_roles
CREATE POLICY "Users view own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users pick own non-admin role" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND role <> 'admin');

-- POLICIES: food_listings
CREATE POLICY "Signed-in users can view listings" ON public.food_listings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Donors create own listings" ON public.food_listings FOR INSERT TO authenticated WITH CHECK (auth.uid() = donor_id);
CREATE POLICY "Donors update own listings" ON public.food_listings FOR UPDATE TO authenticated USING (auth.uid() = donor_id OR public.has_role(auth.uid(), 'admin')) WITH CHECK (auth.uid() = donor_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Donors delete own listings" ON public.food_listings FOR DELETE TO authenticated USING (auth.uid() = donor_id OR public.has_role(auth.uid(), 'admin'));

-- POLICIES: claims
CREATE POLICY "Claim parties can view claims" ON public.claims FOR SELECT TO authenticated USING (
  auth.uid() = ngo_id
  OR public.has_role(auth.uid(), 'admin')
  OR EXISTS (SELECT 1 FROM public.food_listings l WHERE l.id = listing_id AND l.donor_id = auth.uid())
);
CREATE POLICY "NGOs create own claims" ON public.claims FOR INSERT TO authenticated WITH CHECK (auth.uid() = ngo_id);
CREATE POLICY "Claim parties update claims" ON public.claims FOR UPDATE TO authenticated USING (
  auth.uid() = ngo_id
  OR public.has_role(auth.uid(), 'admin')
  OR EXISTS (SELECT 1 FROM public.food_listings l WHERE l.id = listing_id AND l.donor_id = auth.uid())
) WITH CHECK (
  auth.uid() = ngo_id
  OR public.has_role(auth.uid(), 'admin')
  OR EXISTS (SELECT 1 FROM public.food_listings l WHERE l.id = listing_id AND l.donor_id = auth.uid())
);
CREATE POLICY "NGOs delete own claims" ON public.claims FOR DELETE TO authenticated USING (auth.uid() = ngo_id OR public.has_role(auth.uid(), 'admin'));

-- POLICIES: pickups
CREATE POLICY "Pickup parties can view pickups" ON public.pickups FOR SELECT TO authenticated USING (
  auth.uid() = volunteer_id
  OR public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.claims c JOIN public.food_listings l ON l.id = c.listing_id
    WHERE c.id = claim_id AND (c.ngo_id = auth.uid() OR l.donor_id = auth.uid())
  )
);
CREATE POLICY "Pickup parties create pickups" ON public.pickups FOR INSERT TO authenticated WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.claims c JOIN public.food_listings l ON l.id = c.listing_id
    WHERE c.id = claim_id AND (c.ngo_id = auth.uid() OR l.donor_id = auth.uid())
  )
);
CREATE POLICY "Pickup parties update pickups" ON public.pickups FOR UPDATE TO authenticated USING (
  auth.uid() = volunteer_id
  OR public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.claims c JOIN public.food_listings l ON l.id = c.listing_id
    WHERE c.id = claim_id AND (c.ngo_id = auth.uid() OR l.donor_id = auth.uid())
  )
) WITH CHECK (
  auth.uid() = volunteer_id
  OR public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.claims c JOIN public.food_listings l ON l.id = c.listing_id
    WHERE c.id = claim_id AND (c.ngo_id = auth.uid() OR l.donor_id = auth.uid())
  )
);

-- POLICIES: impact_records
CREATE POLICY "Signed-in users can view impact" ON public.impact_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "Parties record impact" ON public.impact_records FOR INSERT TO authenticated WITH CHECK (auth.uid() = ngo_id OR auth.uid() = donor_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update impact" ON public.impact_records FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete impact" ON public.impact_records FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Triggers
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_listings_updated BEFORE UPDATE ON public.food_listings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_claims_updated BEFORE UPDATE ON public.claims FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_pickups_updated BEFORE UPDATE ON public.pickups FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, org_name, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    NEW.raw_user_meta_data->>'org_name',
    NEW.raw_user_meta_data->>'phone'
  )
  ON CONFLICT (id) DO NOTHING;

  IF NEW.raw_user_meta_data->>'role' IN ('donor', 'ngo', 'volunteer') THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, (NEW.raw_user_meta_data->>'role')::public.app_role)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Indexes
CREATE INDEX idx_listings_status ON public.food_listings (status);
CREATE INDEX idx_listings_donor ON public.food_listings (donor_id);
CREATE INDEX idx_claims_listing ON public.claims (listing_id);
CREATE INDEX idx_claims_ngo ON public.claims (ngo_id);
CREATE INDEX idx_pickups_claim ON public.pickups (claim_id);
CREATE INDEX idx_impact_completed ON public.impact_records (completed_at);