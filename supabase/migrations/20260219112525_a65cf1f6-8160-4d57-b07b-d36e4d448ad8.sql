-- Add status column to visits to distinguish normal vs skipped visits
ALTER TABLE public.visits
  ALTER COLUMN arrival_time DROP NOT NULL,
  ALTER COLUMN leaving_time DROP NOT NULL,
  ADD COLUMN status text NOT NULL DEFAULT 'visited';

-- Update duration_minutes to be nullable for skipped visits
ALTER TABLE public.visits
  ALTER COLUMN duration_minutes DROP NOT NULL;