ALTER TABLE public.customers ADD COLUMN price_category text DEFAULT NULL;

COMMENT ON COLUMN public.customers.price_category IS 'Price category: Price A, Price B, or Price C';