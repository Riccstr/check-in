
-- Fix race condition in auto_assign_role by adding table lock
CREATE OR REPLACE FUNCTION public.auto_assign_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  user_count INTEGER;
  available_rep_id UUID;
BEGIN
  -- Lock the user_roles table to prevent race conditions during concurrent signups
  LOCK TABLE public.user_roles IN SHARE ROW EXCLUSIVE MODE;
  
  SELECT COUNT(*) INTO user_count FROM public.user_roles;
  
  IF user_count = 0 THEN
    -- First user becomes admin (no rep linking)
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    -- Subsequent users become reps
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'rep');
    
    -- Only link to a rep record if the user is a rep (not admin)
    SELECT id INTO available_rep_id FROM public.reps WHERE user_id IS NULL AND is_active = true LIMIT 1;
    IF available_rep_id IS NOT NULL THEN
      UPDATE public.reps SET user_id = NEW.id WHERE id = available_rep_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;
