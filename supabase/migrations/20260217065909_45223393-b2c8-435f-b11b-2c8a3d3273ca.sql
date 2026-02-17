
-- Add new columns to reps
ALTER TABLE public.reps ADD COLUMN IF NOT EXISTS surname text;
ALTER TABLE public.reps ADD COLUMN IF NOT EXISTS cell_no text;
ALTER TABLE public.reps ADD COLUMN IF NOT EXISTS email text;

-- Schedule templates (recurring weekly patterns)
CREATE TABLE public.schedule_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id uuid NOT NULL REFERENCES public.reps(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(rep_id, day_of_week)
);

ALTER TABLE public.schedule_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage schedule_templates"
  ON public.schedule_templates FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Reps can view own templates"
  ON public.schedule_templates FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM reps r WHERE r.id = schedule_templates.rep_id AND r.user_id = auth.uid()));

-- Template items (customers in a recurring template)
CREATE TABLE public.schedule_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.schedule_templates(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE(template_id, customer_id)
);

ALTER TABLE public.schedule_template_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage template_items"
  ON public.schedule_template_items FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Reps can view own template_items"
  ON public.schedule_template_items FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM schedule_templates st
    JOIN reps r ON r.id = st.rep_id
    WHERE st.id = schedule_template_items.template_id AND r.user_id = auth.uid()
  ));

-- Daily schedules (one-off or generated from templates)
CREATE TABLE public.daily_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id uuid NOT NULL REFERENCES public.reps(id) ON DELETE CASCADE,
  schedule_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(rep_id, schedule_date)
);

ALTER TABLE public.daily_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage daily_schedules"
  ON public.daily_schedules FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Reps can view own daily_schedules"
  ON public.daily_schedules FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM reps r WHERE r.id = daily_schedules.rep_id AND r.user_id = auth.uid()));

-- Schedule items (customers on a daily schedule with visit logging fields)
CREATE TABLE public.schedule_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.daily_schedules(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','visited','skipped')),
  arrival_time time,
  leaving_time time,
  duration_minutes integer,
  notes text,
  visit_id uuid REFERENCES public.visits(id),
  UNIQUE(schedule_id, customer_id)
);

ALTER TABLE public.schedule_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage schedule_items"
  ON public.schedule_items FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Reps can view own schedule_items"
  ON public.schedule_items FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM daily_schedules ds
    JOIN reps r ON r.id = ds.rep_id
    WHERE ds.id = schedule_items.schedule_id AND r.user_id = auth.uid()
  ));

CREATE POLICY "Reps can update own schedule_items"
  ON public.schedule_items FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM daily_schedules ds
    JOIN reps r ON r.id = ds.rep_id
    WHERE ds.id = schedule_items.schedule_id AND r.user_id = auth.uid()
  ));
