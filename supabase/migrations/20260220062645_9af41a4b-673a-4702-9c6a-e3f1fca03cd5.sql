ALTER TABLE public.schedule_items
  DROP CONSTRAINT schedule_items_visit_id_fkey;

ALTER TABLE public.schedule_items
  ADD CONSTRAINT schedule_items_visit_id_fkey
  FOREIGN KEY (visit_id) REFERENCES public.visits(id) ON DELETE SET NULL;