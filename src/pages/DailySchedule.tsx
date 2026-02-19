import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CalendarDays, Clock, Check, SkipForward, Plus, Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

export default function DailySchedule() {
  const { repId } = useAuth();
  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().split("T")[0]);
  const [schedule, setSchedule] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [currentWeekName, setCurrentWeekName] = useState<string>("");

  // Ad-hoc visit state
  const [adHocOpen, setAdHocOpen] = useState(false);
  const [adHocCustomers, setAdHocCustomers] = useState<any[]>([]);
  const [adHocCustomerId, setAdHocCustomerId] = useState("");
  const [adHocArrival, setAdHocArrival] = useState("");
  const [adHocLeaving, setAdHocLeaving] = useState("");
  const [adHocNotes, setAdHocNotes] = useState("");
  const [adHocSubmitting, setAdHocSubmitting] = useState(false);

  const autoGenerateSchedule = useCallback(async () => {
    if (!repId) return null;

    // Get current week setting
    const { data: setting } = await supabase
      .from("app_settings")
      .select("setting_value")
      .eq("setting_key", "current_week_order")
      .maybeSingle();

    const weekOrder = parseInt(setting?.setting_value || "1");

    // Get weekly template with this sort_order
    const { data: weeklyTemplate } = await supabase
      .from("weekly_templates")
      .select("id, name")
      .eq("sort_order", weekOrder)
      .maybeSingle();

    if (!weeklyTemplate) return null;
    setCurrentWeekName(weeklyTemplate.name);

    // Get day of week (1=Mon, 5=Fri)
    const dayOfWeek = new Date(scheduleDate + "T12:00:00").getDay();
    // Skip weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) return null;

    // Find the schedule template for this rep + day + weekly template
    const { data: tmpl } = await supabase
      .from("schedule_templates")
      .select("id, schedule_template_items(customer_id, sort_order)")
      .eq("rep_id", repId)
      .eq("day_of_week", dayOfWeek)
      .eq("weekly_template_id", weeklyTemplate.id)
      .maybeSingle();

    if (!tmpl || !tmpl.schedule_template_items?.length) return null;

    // Create daily schedule
    const { data: newSchedule, error: schedErr } = await supabase
      .from("daily_schedules")
      .insert({ rep_id: repId, schedule_date: scheduleDate })
      .select("id")
      .single();

    if (schedErr) {
      console.error("Auto-generate error:", schedErr.message);
      return null;
    }

    // Create schedule items from template
    const scheduleItems = tmpl.schedule_template_items
      .sort((a: any, b: any) => a.sort_order - b.sort_order)
      .map((ti: any, i: number) => ({
        schedule_id: newSchedule.id,
        customer_id: ti.customer_id,
        sort_order: i,
        status: "pending",
      }));

    await supabase.from("schedule_items").insert(scheduleItems);
    return newSchedule.id;
  }, [repId, scheduleDate]);

  useEffect(() => {
    if (repId) {
      fetchSchedule();
      fetchAdHocCustomers();
    }
  }, [repId, scheduleDate]);

  const fetchSchedule = async () => {
    if (!repId) return;
    setLoading(true);

    const { data } = await supabase
      .from("daily_schedules")
      .select("*, schedule_items(*, customers(customer_name))")
      .eq("rep_id", repId)
      .eq("schedule_date", scheduleDate)
      .maybeSingle();

    if (data) {
      setSchedule(data);
      setItems(
        (data.schedule_items || []).sort((a: any, b: any) => a.sort_order - b.sort_order)
      );
      // Fetch current week name for display
      const { data: setting } = await supabase
        .from("app_settings")
        .select("setting_value")
        .eq("setting_key", "current_week_order")
        .maybeSingle();
      if (setting) {
        const { data: wk } = await supabase
          .from("weekly_templates")
          .select("name")
          .eq("sort_order", parseInt(setting.setting_value))
          .maybeSingle();
        if (wk) setCurrentWeekName(wk.name);
      }
      setLoading(false);
    } else {
      // Try auto-generating
      setGenerating(true);
      const newId = await autoGenerateSchedule();
      setGenerating(false);

      if (newId) {
        // Re-fetch the newly created schedule
        const { data: newData } = await supabase
          .from("daily_schedules")
          .select("*, schedule_items(*, customers(customer_name))")
          .eq("id", newId)
          .single();

        setSchedule(newData);
        setItems(
          (newData?.schedule_items || []).sort((a: any, b: any) => a.sort_order - b.sort_order)
        );
      } else {
        setSchedule(null);
        setItems([]);
      }
      setLoading(false);
    }
  };

  const fetchAdHocCustomers = async () => {
    if (!repId) return;
    const { data } = await supabase
      .from("customer_assignments")
      .select("customer_id, customers(id, customer_name, is_active)")
      .eq("rep_id", repId);
    if (data) {
      setAdHocCustomers(
        data.filter((d: any) => d.customers?.is_active).map((d: any) => d.customers)
      );
    }
  };

  const nowTime = () => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  };

  const calcDuration = (arr: string, lv: string) => {
    if (!arr || !lv) return 0;
    const [ah, am] = arr.split(":").map(Number);
    const [lh, lm] = lv.split(":").map(Number);
    return (lh * 60 + lm) - (ah * 60 + am);
  };

  const updateItem = async (item: any, updates: Partial<{ arrival_time: string; leaving_time: string; notes: string; status: string; duration_minutes: number }>) => {
    const newItem = { ...item, ...updates };

    if (newItem.arrival_time && newItem.leaving_time) {
      newItem.duration_minutes = calcDuration(newItem.arrival_time, newItem.leaving_time);
    }

    const { error } = await supabase
      .from("schedule_items")
      .update({
        arrival_time: newItem.arrival_time || null,
        leaving_time: newItem.leaving_time || null,
        duration_minutes: newItem.duration_minutes || null,
        notes: newItem.notes || null,
        status: newItem.status,
      })
      .eq("id", item.id);

    if (error) {
      toast.error(error.message);
    } else {
      if (newItem.status === "visited" && newItem.arrival_time && newItem.leaving_time && newItem.duration_minutes > 0) {
        if (item.visit_id) {
          await supabase.from("visits").update({
            arrival_time: newItem.arrival_time,
            leaving_time: newItem.leaving_time,
            duration_minutes: newItem.duration_minutes,
            notes: newItem.notes || null,
          }).eq("id", item.visit_id);
        } else {
          const { data: visit } = await supabase.from("visits").insert({
            rep_id: repId!,
            customer_id: item.customer_id,
            visit_date: scheduleDate,
            arrival_time: newItem.arrival_time,
            leaving_time: newItem.leaving_time,
            duration_minutes: newItem.duration_minutes,
            notes: newItem.notes || null,
          }).select("id").single();

          if (visit) {
            await supabase.from("schedule_items").update({ visit_id: visit.id }).eq("id", item.id);
          }
        }
      }
      fetchSchedule();
    }
  };

  const markArrived = (item: any) => {
    updateItem(item, { arrival_time: nowTime(), status: "visited" });
  };

  const markLeft = (item: any) => {
    updateItem(item, { leaving_time: nowTime() });
  };

  const skipItem = (item: any) => {
    updateItem(item, { status: "skipped" });
  };

  // Ad-hoc visit
  const submitAdHoc = async () => {
    if (!repId || !adHocCustomerId || !adHocArrival || !adHocLeaving) return;
    const dur = calcDuration(adHocArrival, adHocLeaving);
    if (dur <= 0) { toast.error("Leaving must be after arrival"); return; }

    setAdHocSubmitting(true);
    const { error } = await supabase.from("visits").insert({
      rep_id: repId,
      customer_id: adHocCustomerId,
      visit_date: scheduleDate,
      arrival_time: adHocArrival,
      leaving_time: adHocLeaving,
      duration_minutes: dur,
      notes: adHocNotes || null,
    });

    if (error) toast.error(error.message);
    else {
      toast.success("Ad-hoc visit logged");
      setAdHocOpen(false);
      setAdHocCustomerId("");
      setAdHocArrival("");
      setAdHocLeaving("");
      setAdHocNotes("");
    }
    setAdHocSubmitting(false);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-accent" /> Today's Schedule
            </CardTitle>
            {currentWeekName && (
              <p className="text-sm text-muted-foreground mt-1">{currentWeekName}</p>
            )}
          </div>
          <Input
            type="date"
            value={scheduleDate}
            onChange={(e) => setScheduleDate(e.target.value)}
            className="w-auto"
          />
        </CardHeader>
        <CardContent>
          {loading || generating ? (
            <div className="flex items-center gap-2 text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              {generating ? "Generating schedule from template..." : "Loading..."}
            </div>
          ) : !schedule ? (
            <div className="text-center py-8 text-muted-foreground">
              <CalendarDays className="h-12 w-12 mx-auto mb-2 opacity-30" />
              <p>No schedule for this date</p>
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={`border rounded-lg p-3 space-y-2 ${
                    item.status === "visited" ? "border-primary/30 bg-primary/5" :
                    item.status === "skipped" ? "border-muted bg-muted/30 opacity-60" :
                    "border-border"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{item.customers?.customer_name}</span>
                    <Badge variant={item.status === "visited" ? "default" : item.status === "skipped" ? "secondary" : "outline"}>
                      {item.status}
                    </Badge>
                  </div>

                  {item.status !== "skipped" && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-muted-foreground">Arrival</label>
                        <div className="flex gap-1">
                          <Input
                            type="time"
                            value={item.arrival_time || ""}
                            onChange={(e) => updateItem(item, { arrival_time: e.target.value })}
                            className="h-8 text-sm"
                          />
                          {!item.arrival_time && (
                            <Button size="sm" variant="outline" className="h-8 text-xs shrink-0" onClick={() => markArrived(item)}>
                              <Clock className="h-3 w-3 mr-1" /> Now
                            </Button>
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Leaving</label>
                        <div className="flex gap-1">
                          <Input
                            type="time"
                            value={item.leaving_time || ""}
                            onChange={(e) => updateItem(item, { leaving_time: e.target.value })}
                            className="h-8 text-sm"
                          />
                          {item.arrival_time && !item.leaving_time && (
                            <Button size="sm" variant="outline" className="h-8 text-xs shrink-0" onClick={() => markLeft(item)}>
                              <Clock className="h-3 w-3 mr-1" /> Now
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {item.status !== "skipped" && item.duration_minutes > 0 && (
                    <div className="text-xs text-muted-foreground">Duration: {item.duration_minutes} min</div>
                  )}

                  {item.status !== "skipped" && (
                    <Textarea
                      placeholder="Notes..."
                      value={item.notes || ""}
                      onChange={(e) => updateItem(item, { notes: e.target.value })}
                      rows={1}
                      className="text-sm"
                    />
                  )}

                  {item.status === "pending" && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => skipItem(item)}>
                        <SkipForward className="h-3 w-3 mr-1" /> Skip
                      </Button>
                      {item.arrival_time && item.leaving_time && calcDuration(item.arrival_time, item.leaving_time) > 0 && (
                        <Button size="sm" onClick={() => updateItem(item, { status: "visited" })}>
                          <Check className="h-3 w-3 mr-1" /> Mark Visited
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Ad-hoc Visit */}
      <Card>
        <CardHeader className="pb-2">
          <Button variant="outline" size="sm" onClick={() => setAdHocOpen(!adHocOpen)}>
            <Plus className="h-4 w-4 mr-1" /> Log Unscheduled Visit
          </Button>
        </CardHeader>
        {adHocOpen && (
          <CardContent className="space-y-3">
            <div>
              <Label>Customer</Label>
              <Select value={adHocCustomerId} onValueChange={setAdHocCustomerId}>
                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>
                  {adHocCustomers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.customer_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Arrival</Label>
                <div className="flex gap-1">
                  <Input type="time" value={adHocArrival} onChange={(e) => setAdHocArrival(e.target.value)} />
                  <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setAdHocArrival(nowTime())}>
                    <Clock className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <div>
                <Label>Leaving</Label>
                <div className="flex gap-1">
                  <Input type="time" value={adHocLeaving} onChange={(e) => setAdHocLeaving(e.target.value)} />
                  <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setAdHocLeaving(nowTime())}>
                    <Clock className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={adHocNotes} onChange={(e) => setAdHocNotes(e.target.value)} rows={2} />
            </div>
            <Button onClick={submitAdHoc} disabled={adHocSubmitting || !adHocCustomerId || !adHocArrival || !adHocLeaving} className="w-full">
              {adHocSubmitting ? "Saving..." : "Log Visit"}
            </Button>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
