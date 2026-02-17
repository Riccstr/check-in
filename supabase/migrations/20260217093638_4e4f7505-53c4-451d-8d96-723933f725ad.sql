
-- Drop the existing restrictive policy for reps viewing customers
DROP POLICY "Reps can view assigned customers" ON public.customers;

-- Create a new policy that allows reps to see customers assigned to them OR on their schedules
CREATE POLICY "Reps can view assigned customers"
ON public.customers
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM customer_assignments ca
    JOIN reps r ON r.id = ca.rep_id
    WHERE ca.customer_id = customers.id AND r.user_id = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM schedule_items si
    JOIN daily_schedules ds ON ds.id = si.schedule_id
    JOIN reps r ON r.id = ds.rep_id
    WHERE si.customer_id = customers.id AND r.user_id = auth.uid()
  )
);
