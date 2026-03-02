
-- Add the cycle start date reference point
-- Current week is Week 1a (sort_order=1), and today (2026-03-02) is a Monday
INSERT INTO app_settings (setting_key, setting_value)
VALUES ('week_cycle_start_date', '2026-03-02')
ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value;

-- Create a helper function to compute the current week order for any date
CREATE OR REPLACE FUNCTION public.get_week_order_for_date(p_date date)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cycle_start date;
  v_weeks_elapsed int;
  v_total_weeks int;
  v_week_index int;
BEGIN
  SELECT setting_value::date INTO v_cycle_start
  FROM app_settings
  WHERE setting_key = 'week_cycle_start_date';

  IF v_cycle_start IS NULL THEN
    -- Fallback to current_week_order static setting
    SELECT setting_value::int INTO v_week_index
    FROM app_settings
    WHERE setting_key = 'current_week_order';
    RETURN COALESCE(v_week_index, 1);
  END IF;

  -- Count active weekly templates
  SELECT COUNT(*) INTO v_total_weeks
  FROM weekly_templates
  WHERE is_active = true;

  IF v_total_weeks = 0 THEN
    RETURN 1;
  END IF;

  -- Compute weeks elapsed (can be negative if date is before start)
  v_weeks_elapsed := FLOOR((p_date - v_cycle_start) / 7.0)::int;
  
  -- Modulo to cycle (handle negative values)
  v_week_index := ((v_weeks_elapsed % v_total_weeks) + v_total_weeks) % v_total_weeks + 1;

  RETURN v_week_index;
END;
$$;

-- Update auto_generate_daily_schedule to use the dynamic week computation
CREATE OR REPLACE FUNCTION public.auto_generate_daily_schedule(p_rep_id uuid, p_schedule_date date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing_id uuid;
  v_week_order int;
  v_weekly_template_id uuid;
  v_day_of_week int;
  v_template_id uuid;
  v_new_schedule_id uuid;
BEGIN
  -- Check if schedule already exists
  SELECT id INTO v_existing_id
  FROM daily_schedules
  WHERE rep_id = p_rep_id AND schedule_date = p_schedule_date;
  
  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  -- Get day of week (1=Mon..5=Fri, skip weekends)
  v_day_of_week := EXTRACT(ISODOW FROM p_schedule_date)::int;
  IF v_day_of_week > 5 THEN
    RETURN NULL;
  END IF;

  -- Dynamically compute week order based on date
  v_week_order := get_week_order_for_date(p_schedule_date);

  -- Also update the static setting for display purposes
  UPDATE app_settings
  SET setting_value = v_week_order::text, updated_at = now()
  WHERE setting_key = 'current_week_order';

  -- Get weekly template
  SELECT id INTO v_weekly_template_id
  FROM weekly_templates
  WHERE sort_order = v_week_order AND is_active = true;
  
  IF v_weekly_template_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Get schedule template for this rep/day/week
  SELECT id INTO v_template_id
  FROM schedule_templates
  WHERE rep_id = p_rep_id
    AND day_of_week = v_day_of_week
    AND weekly_template_id = v_weekly_template_id;
  
  IF v_template_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Check template has items
  IF NOT EXISTS (SELECT 1 FROM schedule_template_items WHERE template_id = v_template_id) THEN
    RETURN NULL;
  END IF;

  -- Create daily schedule
  INSERT INTO daily_schedules (rep_id, schedule_date)
  VALUES (p_rep_id, p_schedule_date)
  RETURNING id INTO v_new_schedule_id;

  -- Create schedule items from template
  INSERT INTO schedule_items (schedule_id, customer_id, sort_order, status)
  SELECT v_new_schedule_id, sti.customer_id, sti.sort_order, 'pending'
  FROM schedule_template_items sti
  WHERE sti.template_id = v_template_id
  ORDER BY sti.sort_order;

  RETURN v_new_schedule_id;
END;
$$;
