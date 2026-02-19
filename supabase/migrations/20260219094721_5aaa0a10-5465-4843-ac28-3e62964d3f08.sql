
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

  -- Get current week order
  SELECT setting_value::int INTO v_week_order
  FROM app_settings
  WHERE setting_key = 'current_week_order';
  
  IF v_week_order IS NULL THEN
    RETURN NULL;
  END IF;

  -- Get weekly template
  SELECT id INTO v_weekly_template_id
  FROM weekly_templates
  WHERE sort_order = v_week_order;
  
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
