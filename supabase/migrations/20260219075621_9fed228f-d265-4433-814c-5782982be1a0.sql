
-- Weekly templates (global, named rotation weeks)
CREATE TABLE public.weekly_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.weekly_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage weekly_templates"
  ON public.weekly_templates FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can view weekly_templates"
  ON public.weekly_templates FOR SELECT TO authenticated
  USING (true);

-- Seed the 4 default weeks
INSERT INTO public.weekly_templates (name, sort_order) VALUES
  ('Week 1a', 1),
  ('Week 1b', 2),
  ('Week 2a', 3),
  ('Week 2b', 4);

-- App settings (key-value, for current week tracking)
CREATE TABLE public.app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text NOT NULL UNIQUE,
  setting_value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage app_settings"
  ON public.app_settings FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can view app_settings"
  ON public.app_settings FOR SELECT TO authenticated
  USING (true);

-- Seed current week setting (sort_order 1 = Week 1a)
INSERT INTO public.app_settings (setting_key, setting_value) VALUES ('current_week_order', '1');

-- Add weekly_template_id to schedule_templates
ALTER TABLE public.schedule_templates
  ADD COLUMN weekly_template_id uuid REFERENCES public.weekly_templates(id) ON DELETE CASCADE;

-- Drop old unique constraint on (rep_id, day_of_week) if it exists, and create new one including weekly_template_id
-- First find and drop the old constraint
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT c.conname INTO constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'schedule_templates'
    AND c.contype = 'u'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.schedule_templates DROP CONSTRAINT ' || constraint_name;
  END IF;
END $$;

-- New unique: one template per rep per day per weekly template
CREATE UNIQUE INDEX idx_schedule_templates_rep_day_week
  ON public.schedule_templates (rep_id, day_of_week, weekly_template_id)
  WHERE weekly_template_id IS NOT NULL;
