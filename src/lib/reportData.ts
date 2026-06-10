import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { fmtDuration, fmtDate } from "@/lib/timeUtils";

export interface ReportData {
  data: any[];
  repName: string;
  totalProductiveMins: number;
  totalOrderQty: number;
  totalOrderAmount: number;
  skippedCount: number;
  travelTimeMins: number | null;
  scheduleItemCount: number;
  weekTemplateName: string;
  expectedProductiveMins: number;
  timePerCustomer: number;
  generatedAt: string;
  period: string;
  scheduleDayName: string;
  scheduleDayStr: string;
  areasStr: string;
  bannerLine2: string;
  unscheduledVisitIds: Set<string>;
}

export async function buildReportData(
  repId: string,
  repName: string,
  custFilter: string,
  dateFrom: string,
  dateTo: string,
): Promise<ReportData | null> {
  let q = supabase
    .from("visits")
    .select("*, reps(rep_name), customers(customer_name, area, account_number)")
    .eq("rep_id", repId)
    .neq("status", "in_progress")
    .eq("is_deleted", false)
    .order("visit_date", { ascending: true })
    .order("arrival_time", { ascending: true });
  if (dateFrom) q = q.gte("visit_date", dateFrom);
  if (dateTo) q = q.lte("visit_date", dateTo);
  if (custFilter !== "all") q = q.eq("customer_id", custFilter);

  const { data } = await q;
  if (!data || data.length === 0) return null;

  const { data: linkedRows } = await supabase
    .from("schedule_items")
    .select("visit_id")
    .not("visit_id", "is", null)
    .in(
      "schedule_id",
      (
        await supabase
          .from("daily_schedules")
          .select("id")
          .eq("rep_id", repId)
          .gte("schedule_date", dateFrom)
          .lte("schedule_date", dateTo || dateFrom)
      ).data?.map((d: any) => d.id) ?? []
    );

  const linkedVisitIds = new Set<string>(
    (linkedRows ?? []).map((r: any) => r.visit_id).filter(Boolean)
  );

  const unscheduledVisitIds = new Set<string>(
    (data as any[])
      .filter((v: any) => v.status === "visited" && !linkedVisitIds.has(v.id))
      .map((v: any) => v.id)
  );

  let totalProductiveMins = 0;
  let totalOrderQty = 0;
  let totalOrderAmount = 0;
  let skippedCount = 0;
  for (const v of data as any[]) {
    if (v.status === "skipped") { skippedCount++; continue; }
    totalProductiveMins += v.duration_minutes || 0;
    totalOrderQty += v.order_quantity || 0;
    totalOrderAmount += Number(v.order_amount) || 0;
  }

  let travelTimeMins: number | null = null;
  let scheduleItemCount = 0;
  let weekTemplateName = "";
  let scheduleDaysCount = 0;

  const isMultiDay = !!dateTo && dateTo !== dateFrom;

  if (!isMultiDay) {
    // Single-day path — existing logic unchanged
    const { data: dsData } = await (supabase as any)
      .from("daily_schedules")
      .select("weekly_template_id, schedule_date, schedule_items(id)")
      .eq("rep_id", repId)
      .eq("schedule_date", dateFrom)
      .maybeSingle() as { data: { weekly_template_id: string | null; schedule_date: string; schedule_items: any[] } | null };
    if (dsData) {
      scheduleItemCount = (dsData.schedule_items as any[])?.length ?? 0;
      if (dsData.weekly_template_id) {
        const { data: weekTmpl } = await supabase
          .from("weekly_templates")
          .select("name")
          .eq("id", dsData.weekly_template_id)
          .maybeSingle();
        if (weekTmpl) weekTemplateName = weekTmpl.name;

        const jsDay = new Date(dsData.schedule_date + "T12:00:00").getDay();
        const isoDow = jsDay === 0 ? 7 : jsDay;
        const { data: tmplData } = await (supabase as any)
          .from("schedule_templates")
          .select("travel_time_minutes")
          .eq("rep_id", repId)
          .eq("day_of_week", isoDow)
          .eq("weekly_template_id", dsData.weekly_template_id)
          .maybeSingle() as { data: { travel_time_minutes: number | null } | null };
        if (tmplData) travelTimeMins = tmplData.travel_time_minutes;
      }
    }
  } else {
    // Multi-day path — fetch all daily schedules in range, sum metrics
    const { data: dsRows } = await (supabase as any)
      .from("daily_schedules")
      .select("weekly_template_id, schedule_date, schedule_items(id)")
      .eq("rep_id", repId)
      .gte("schedule_date", dateFrom)
      .lte("schedule_date", dateTo) as { data: { weekly_template_id: string | null; schedule_date: string; schedule_items: any[] }[] | null };

    if (dsRows && dsRows.length > 0) {
      let totalTravelMins = 0;
      let totalScheduleItems = 0;
      let anyScheduleFound = false;

      for (const dsData of dsRows) {
        // Only include days where we can fetch a template
        if (!dsData.weekly_template_id) continue;

        const jsDay = new Date(dsData.schedule_date + "T12:00:00").getDay();
        const isoDow = jsDay === 0 ? 7 : jsDay;

        const { data: tmplData } = await (supabase as any)
          .from("schedule_templates")
          .select("travel_time_minutes")
          .eq("rep_id", repId)
          .eq("day_of_week", isoDow)
          .eq("weekly_template_id", dsData.weekly_template_id)
          .maybeSingle() as { data: { travel_time_minutes: number | null } | null };

        // Only include this day if we successfully fetched a template
        if (!tmplData) continue;

        anyScheduleFound = true;
        scheduleDaysCount += 1;
        const dayTravelMins = tmplData.travel_time_minutes ?? 0;
        totalTravelMins += dayTravelMins;
        totalScheduleItems += (dsData.schedule_items as any[])?.length ?? 0;
      }

      if (anyScheduleFound) {
        travelTimeMins = totalTravelMins;
        scheduleItemCount = totalScheduleItems;
      }
    }
  }

  const travelTimeForCalc = travelTimeMins ?? 0;
  const expectedProductiveMins = isMultiDay
    ? (scheduleDaysCount * 540) - travelTimeForCalc
    : 540 - travelTimeForCalc;
  const timePerCustomer = scheduleItemCount > 0 ? Math.round(expectedProductiveMins / scheduleItemCount) : 0;

  const generatedAt = format(new Date(), "dd MMM yyyy HH:mm");
  const period = dateTo && dateTo !== dateFrom
    ? `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`
    : fmtDate(dateFrom);

  const scheduleDayName = format(new Date(dateFrom + "T12:00:00"), "EEEE");
  const scheduleDayStr = weekTemplateName ? `${scheduleDayName} · ${weekTemplateName}` : scheduleDayName;
  const distinctAreas = [...new Set((data as any[]).map((v: any) => v.customers?.area).filter(Boolean))] as string[];
  const areasStr = distinctAreas.join(" · ");
  const bannerLine2 = [areasStr, scheduleDayStr].filter(Boolean).join("   |   ");

  return {
    data,
    repName,
    totalProductiveMins,
    totalOrderQty,
    totalOrderAmount,
    skippedCount,
    travelTimeMins,
    scheduleItemCount,
    weekTemplateName,
    expectedProductiveMins,
    timePerCustomer,
    generatedAt,
    period,
    scheduleDayName,
    scheduleDayStr,
    areasStr,
    bannerLine2,
    unscheduledVisitIds,
  };
}
