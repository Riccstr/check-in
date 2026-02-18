-- Add client_generated_id for offline idempotency
ALTER TABLE public.visits ADD COLUMN client_generated_id uuid DEFAULT NULL;

-- Create unique index for deduplication
CREATE UNIQUE INDEX idx_visits_client_generated_id ON public.visits (client_generated_id) WHERE client_generated_id IS NOT NULL;