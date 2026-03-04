
-- Add location and photo columns to visits table
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS longitude double precision;
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS location_address text;
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS photo_url text;

-- Create storage bucket for visit photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('visit-photos', 'visit-photos', true)
ON CONFLICT (id) DO NOTHING;

-- RLS: Reps can upload to their own folder (rep_id as folder name)
CREATE POLICY "Reps can upload visit photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'visit-photos');

CREATE POLICY "Anyone can view visit photos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'visit-photos');

CREATE POLICY "Reps can delete own visit photos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'visit-photos');
