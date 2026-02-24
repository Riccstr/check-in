-- Remove old name+area uniqueness constraint
DROP INDEX IF EXISTS public.customers_name_area_unique;

-- Add unique constraint on account_number (ignoring nulls)
CREATE UNIQUE INDEX customers_account_number_unique ON public.customers (account_number) WHERE account_number IS NOT NULL;