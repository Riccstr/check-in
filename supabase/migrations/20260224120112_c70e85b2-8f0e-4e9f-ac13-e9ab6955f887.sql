
-- Add login change tracking columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS login_updated_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS login_updated_by uuid;
