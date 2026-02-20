-- Drop the existing unique constraint on customer_name alone
ALTER TABLE public.customers DROP CONSTRAINT customers_customer_name_key;

-- Add a composite unique constraint on (customer_name, area)
-- Using COALESCE in a unique index to handle NULL areas
CREATE UNIQUE INDEX customers_name_area_unique ON public.customers (customer_name, COALESCE(area, ''));