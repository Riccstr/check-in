
-- Create a function that auto-assigns 'admin' role to the first user who signs up
-- and 'rep' role to subsequent users, linking them to available reps
CREATE OR REPLACE FUNCTION public.auto_assign_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_count INTEGER;
  available_rep_id UUID;
BEGIN
  SELECT COUNT(*) INTO user_count FROM public.user_roles;
  
  IF user_count = 0 THEN
    -- First user becomes admin
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    -- Subsequent users become reps
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'rep');
    
    -- Try to link to first available unlinked rep
    SELECT id INTO available_rep_id FROM public.reps WHERE user_id IS NULL AND is_active = true LIMIT 1;
    IF available_rep_id IS NOT NULL THEN
      UPDATE public.reps SET user_id = NEW.id WHERE id = available_rep_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_role
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.auto_assign_role();
