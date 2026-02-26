import { supabase } from "@/integrations/supabase/client";
import { setCachedCustomers, setCachedSchedule } from "@/lib/offlineDb";

type AppRole = "admin" | "rep";

const SCHEDULE_WINDOW_DAYS_BEFORE = 2;
const SCHEDULE_WINDOW_DAYS_AFTER = 7;

function toIsoDate(date: Date) {
  return date.toISOString().split("T")[0];
}

function shiftDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

async function refreshRepCustomers(repId: string) {
  const { data, error } = await supabase
    .from("customer_assignments")
    .select("customer_id, customers(id, customer_name, account_number, area, is_active)")
    .eq("rep_id", repId);

  if (error) throw error;

  const activeCustomers = (data || [])
    .filter((row: any) => row.customers?.is_active)
    .map((row: any) => ({
      id: row.customers.id,
      customer_name: row.customers.customer_name,
      account_number: row.customers.account_number || null,
      area: row.customers.area || null,
    }));

  await setCachedCustomers(activeCustomers);
}

async function refreshRepSchedules(repId: string) {
  const fromDate = shiftDate(-SCHEDULE_WINDOW_DAYS_BEFORE);
  const toDate = shiftDate(SCHEDULE_WINDOW_DAYS_AFTER);

  const { data, error } = await supabase
    .from("daily_schedules")
    .select("id, rep_id, schedule_date, schedule_items(*, customers(customer_name, account_number))")
    .eq("rep_id", repId)
    .gte("schedule_date", fromDate)
    .lte("schedule_date", toDate);

  if (error) throw error;

  for (const schedule of data || []) {
    await setCachedSchedule(repId, schedule.schedule_date, schedule);
  }
}

export async function refreshOfflineBootstrap(userId: string, role: AppRole | null, repId: string | null): Promise<void> {
  if (!navigator.onLine) return;
  if (role !== "rep" || !repId) return;

  try {
    await Promise.all([refreshRepCustomers(repId), refreshRepSchedules(repId)]);
  } catch (err) {
    console.warn(`[OfflineBootstrap] Failed to refresh rep bootstrap for user ${userId}:`, err);
  }
}
