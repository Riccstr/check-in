
-- Create app_role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'rep');

-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- User roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function for role checking
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

-- Reps table
CREATE TABLE public.reps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rep_name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.reps ENABLE ROW LEVEL SECURITY;

-- Customers table
CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

-- Customer assignments table
CREATE TABLE public.customer_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id UUID NOT NULL REFERENCES public.reps(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(rep_id, customer_id)
);
ALTER TABLE public.customer_assignments ENABLE ROW LEVEL SECURITY;

-- Visits table
CREATE TABLE public.visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id UUID NOT NULL REFERENCES public.reps(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  arrival_time TIME NOT NULL,
  leaving_time TIME NOT NULL,
  duration_minutes INTEGER NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- RLS Policies for user_roles
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all roles" ON public.user_roles FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for reps
CREATE POLICY "Admins can manage reps" ON public.reps FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Reps can view own rep" ON public.reps FOR SELECT USING (user_id = auth.uid());

-- RLS Policies for customers
CREATE POLICY "Admins can manage customers" ON public.customers FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Reps can view assigned customers" ON public.customers FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.customer_assignments ca
    JOIN public.reps r ON r.id = ca.rep_id
    WHERE ca.customer_id = customers.id AND r.user_id = auth.uid()
  )
);

-- RLS Policies for assignments
CREATE POLICY "Admins can manage assignments" ON public.customer_assignments FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Reps can view own assignments" ON public.customer_assignments FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.reps r WHERE r.id = rep_id AND r.user_id = auth.uid())
);

-- RLS Policies for visits
CREATE POLICY "Admins can manage visits" ON public.visits FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Reps can view own visits" ON public.visits FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.reps r WHERE r.id = rep_id AND r.user_id = auth.uid())
);
CREATE POLICY "Reps can insert own visits" ON public.visits FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.reps r WHERE r.id = rep_id AND r.user_id = auth.uid())
);
CREATE POLICY "Reps can update own visits" ON public.visits FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.reps r WHERE r.id = rep_id AND r.user_id = auth.uid())
);
CREATE POLICY "Reps can delete own visits" ON public.visits FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.reps r WHERE r.id = rep_id AND r.user_id = auth.uid())
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to get rep_id for current user
CREATE OR REPLACE FUNCTION public.get_my_rep_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.reps WHERE user_id = auth.uid() LIMIT 1
$$;

-- Insert 3 default reps
INSERT INTO public.reps (rep_name) VALUES ('Rep 1'), ('Rep 2'), ('Rep 3');
