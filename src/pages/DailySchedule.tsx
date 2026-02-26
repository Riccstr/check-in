import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CalendarDays, Clock, Check, SkipForward, Plus, Loader2, CircleDot } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { v4 as uuidv4 } from "uuid";
import {
  addOfflineVisit,
  getCachedCustomers,
  setCachedCustomers,
  setCachedSchedule,
  getCachedSchedule,
  upsertOfflineScheduleItemUpdate,
  updateCachedScheduleItem,
} from "@/lib/offlineDb";

function isOfflineError(err: any): boolean {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("load failed") || msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("network request failed");
}

async function saveVisitOffline(
  repId: string,
  customerId: string,
  scheduleDate: string,
  arrivalTime: string,
  leavingTime: string,
  durationMinutes: number,
  notes: string | null,
  customerName?: string,
  status?: string,
) {
  const clientId = uuidv4();
  await addOfflineVisit({
    client_generated_id: clientId,
    payload: {
      rep_id: repId,
      customer_id: customerId,
      visit_date: scheduleDate,
      arrival_time: arrivalTime,
      leaving_time: leavingTime,
      duration_minutes: durationMinutes,
      notes,
      client_generated_id: clientId,
      ...(status ? { status } : {}),
    } as any,
    created_at_local: new Date().toISOString(),
    sync_status: "pending",
    last_sync_attempt: null,
    error_message: null,
    customer_name: customerName,
  });
}

function ScheduleItemRow({
  item,
  repId,
  scheduleDate,
  onRefresh,
  onLocalUpdate,
}: {
  item: any;
  repId: string;
  scheduleDate: string;
  onRefresh: () => void;
  onLocalUpdate: (itemId: string, updates: any) => void;
}) {
  const [localNotes, setLocalNotes] = useState(item.notes || "");
  const [localArrival, setLocalArrival] = useState(item.arrival_time || "");
  const [localLeaving, setLocalLeaving] = useState(item.leaving_time || "");
  const [actionInProgress, setActionInProgress] = useState(false);
  useEffect(() => {
    setLocalNotes(item.notes || "");
  }, [item.notes]);
  useEffect(() => {
    setLocalArrival(item.arrival_time || "");
  }, [item.arrival_time]);
  useEffect(() => {
    setLocalLeaving(item.leaving_time || "");
  }, [item.leaving_time]);

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

  const queueScheduleItemUpdate = async (newItem: any) => {
    await upsertOfflineScheduleItemUpdate({
      schedule_item_id: item.id,
      rep_id: repId,
      schedule_date: scheduleDate,
      customer_id: item.customer_id,
      payload: {
        arrival_time: newItem.arrival_time || null,
        leaving_time: newItem.leaving_time || null,
        duration_minutes: newItem.duration_minutes ?? null,
        notes: newItem.notes || null,
        status: newItem.status || "pending",
      },
      created_at_local: new Date().toISOString(),
      sync_status: "pending",
      last_sync_attempt: null,
      error_message: null,
    });
  };

  const updateItem = async (updates: Partial<{ arrival_time: string; leaving_time: string; notes: string; status: string; duration_minutes: number }>) => {
    if (actionInProgress) return;
    setActionInProgress(true);

    const newItem = { ...item, ...updates };
    if (newItem.arrival_time && newItem.leaving_time) {
      newItem.duration_minutes = calcDuration(newItem.arrival_time, newItem.leaving_time);
    }

    // Always apply optimistic local update first
    onLocalUpdate(item.id, {
      arrival_time: newItem.arrival_time || null,
      leaving_time: newItem.leaving_time || null,
      duration_minutes: newItem.duration_minutes || null,
      notes: newItem.notes || null,
      status: newItem.status,
    });

    try {
      if (!navigator.onLine) {
        await queueScheduleItemUpdate(newItem);
        await handleOfflineVisitSave(newItem);
        return;
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
        if (isOfflineError(error)) {
          await queueScheduleItemUpdate(newItem);
          await handleOfflineVisitSave(newItem);
          return;
        }
        toast.error(error.message);
        return;
      }

      // Online success: also handle visit record
      if (newItem.status === "visited" && newItem.arrival_time && newItem.leaving_time && newItem.duration_minutes >= 0) {
        if (item.visit_id) {
          await supabase.from("visits").update({
            arrival_time: newItem.arrival_time,
            leaving_time: newItem.leaving_time,
            duration_minutes: newItem.duration_minutes,
            notes: newItem.notes || null,
          }).eq("id", item.visit_id);
        } else {
          const { data: visit } = await supabase.from("visits").insert({
            rep_id: repId,
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
      onRefresh();
    } catch (err: any) {
      console.warn("[Schedule] Network error on update:", err?.message);
      await queueScheduleItemUpdate(newItem);
      await handleOfflineVisitSave(newItem);
    } finally {
      setActionInProgress(false);
    }
  };

  const handleOfflineVisitSave = async (newItem: any) => {
    // Only save a visit record if we have both times (complete visit)
    if (newItem.arrival_time && newItem.leaving_time && newItem.duration_minutes >= 0) {
      try {
        await saveVisitOffline(
          repId,
          item.customer_id,
          scheduleDate,
          newItem.arrival_time,
          newItem.leaving_time,
          newItem.duration_minutes,
          newItem.notes || null,
          item.customers?.customer_name,
        );
        toast.success("Saved offline. Will sync when online.");
      } catch (idbErr) {
        console.error("[Schedule] IndexedDB save failed:", idbErr);
        toast.error("Failed to save visit. Please try again.");
      }
    }
    // For partial updates (just arrival_time), the local UI is already updated optimistically
    // No error shown - the user sees their time recorded in the UI
  };

  const commitNotes = () => {
    if (localNotes !== (item.notes || "")) {
      updateItem({ notes: localNotes });
    }
  };

  const commitArrival = () => {
    if (localArrival !== (item.arrival_time || "")) {
      updateItem({ arrival_time: localArrival });
    }
  };

  const commitLeaving = () => {
    if (localLeaving !== (item.leaving_time || "")) {
      updateItem({ leaving_time: localLeaving });
    }
  };

  const markArrived = () => {
    const t = nowTime();
    setLocalArrival(t);
    updateItem({ arrival_time: t });
  };
  const markLeft = () => {
    const t = nowTime();
    setLocalLeaving(t);
    updateItem({ leaving_time: t, status: "visited" });
  };

  const skipItem = async () => {
    if (actionInProgress) return;
    if (!localNotes.trim()) {
      toast.error("Please provide a reason in the notes before skipping");
      return;
    }
    setActionInProgress(true);

    const skippedUpdates = {
      arrival_time: null,
      leaving_time: null,
      duration_minutes: 0,
      notes: localNotes,
      status: "skipped",
    };

    // Optimistic local update
    onLocalUpdate(item.id, skippedUpdates);

    try {
      if (!navigator.onLine) {
        await queueScheduleItemUpdate(skippedUpdates);
        await saveVisitOffline(repId, item.customer_id, scheduleDate, "00:00", "00:00", 0, localNotes, item.customers?.customer_name, "skipped");
        toast.success("Saved offline. Will sync when online.");
        return;
      }

      const { error } = await supabase
        .from("schedule_items")
        .update({ status: "skipped", notes: localNotes })
        .eq("id", item.id);

      if (error) {
        if (isOfflineError(error)) {
          await queueScheduleItemUpdate(skippedUpdates);
          await saveVisitOffline(repId, item.customer_id, scheduleDate, "00:00", "00:00", 0, localNotes, item.customers?.customer_name, "skipped");
          toast.success("Saved offline. Will sync when online.");
          return;
        }
        toast.error(error.message);
        return;
      }

      await supabase.from("visits").insert({
        rep_id: repId,
        customer_id: item.customer_id,
        visit_date: scheduleDate,
        arrival_time: "00:00",
        leaving_time: "00:00",
        duration_minutes: 0,
        notes: localNotes,
        status: "skipped",
      } as any);

      onRefresh();
    } catch (err: any) {
      console.warn("[Schedule] Network error on skip:", err?.message);
      try {
        await queueScheduleItemUpdate(skippedUpdates);
        await saveVisitOffline(repId, item.customer_id, scheduleDate, "00:00", "00:00", 0, localNotes, item.customers?.customer_name, "skipped");
        toast.success("Saved offline. Will sync when online.");
      } catch (idbErr) {
        console.error("[Schedule] IndexedDB save failed:", idbErr);
        toast.error("Failed to save. Please try again.");
      }
    } finally {
      setActionInProgress(false);
    }
  };

  const markVisited = () => updateItem({ status: "visited", arrival_time: localArrival, leaving_time: localLeaving, notes: localNotes });

    const isInProgress = item.status === "pending" && item.arrival_time && !item.leaving_time;

    return (
    <div
      className={`border rounded-lg p-3 space-y-2 ${
        item.status === "visited" ? "border-green-500/30 bg-green-500/10" :
        item.status === "skipped" ? "border-red-500/30 bg-red-500/10" :
        isInProgress ? "border-orange-500/30 bg-orange-500/10" :
        "border-border"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium">
          {item.customers?.account_number && <span className="text-muted-foreground text-xs mr-1">({item.customers.account_number})</span>}
          {item.customers?.customer_name}
        </span>
        {item.status === "visited" ? (
          <Badge variant="default" className="bg-green-600 text-white gap-1">
            <Check className="h-3 w-3" /> Visited
          </Badge>
        ) : item.status === "skipped" ? (
          <Badge variant="secondary" className="bg-red-500/20 text-red-700 border-red-500/30 gap-1">
            <SkipForward className="h-3 w-3" /> Skipped
          </Badge>
        ) : isInProgress ? (
          <Badge variant="outline" className="bg-orange-500/20 text-orange-700 border-orange-500/30 gap-1">
            <CircleDot className="h-3 w-3" /> In Progress
          </Badge>
        ) : (
          <Badge variant="outline">Pending</Badge>
        )}
      </div>

      {item.status !== "skipped" && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground">Arrival</label>
            <div className="flex gap-1">
              <Input
                type="time"
                value={localArrival}
                onChange={(e) => setLocalArrival(e.target.value)}
                onBlur={commitArrival}
                className="h-8 text-sm"
              />
              {!localArrival && (
                <Button size="sm" variant="outline" className="h-8 text-xs shrink-0" onClick={markArrived}>
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
                value={localLeaving}
                onChange={(e) => setLocalLeaving(e.target.value)}
                onBlur={commitLeaving}
                className="h-8 text-sm"
              />
              {localArrival && !localLeaving && (
                <Button size="sm" variant="outline" className="h-8 text-xs shrink-0" onClick={markLeft}>
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
          value={localNotes}
          onChange={(e) => setLocalNotes(e.target.value)}
          onBlur={commitNotes}
          rows={1}
          className="text-sm"
        />
      )}

      {item.status === "pending" && (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={skipItem}>
            <SkipForward className="h-3 w-3 mr-1" /> Skip
          </Button>
          {localArrival && localLeaving && calcDuration(localArrival, localLeaving) > 0 && (
            <Button size="sm" onClick={markVisited}>
              <Check className="h-3 w-3 mr-1" /> Mark Visited
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

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

  // Optimistic local update for schedule items
  const handleLocalUpdate = useCallback((itemId: string, updates: any) => {
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, ...updates } : it)));

    if (repId) {
      updateCachedScheduleItem(repId, scheduleDate, itemId, updates).catch((err) => {
        console.warn("[Schedule] Failed to persist local schedule update:", err);
      });
    }
  }, [repId, scheduleDate]);

  const autoGenerateSchedule = useCallback(async () => {
    if (!repId) return null;
    try {
      const { data, error } = await supabase.rpc("auto_generate_daily_schedule", {
        p_rep_id: repId,
        p_schedule_date: scheduleDate,
      });
      if (error) { console.error("Auto-generate error:", error.message); return null; }
      return data as string | null;
    } catch (err) {
      console.warn("[Schedule] Offline, cannot auto-generate schedule");
      return null;
    }
  }, [repId, scheduleDate]);

  const fetchWeekName = async () => {
    try {
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
    } catch {
      // Offline - ignore
    }
  };

  useEffect(() => {
    if (repId) {
      fetchSchedule();
      fetchAdHocCustomers();
      fetchWeekName();
    }
  }, [repId, scheduleDate]);

  // Realtime: listen for schedule_items changes AND daily_schedules changes for this rep
  useEffect(() => {
    if (!schedule?.id) return;
    const channel = supabase
      .channel(`schedule-items-${schedule.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "schedule_items", filter: `schedule_id=eq.${schedule.id}` }, () => { fetchSchedule(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [schedule?.id]);

  // Realtime: listen for new daily_schedules created for this rep (admin creating/updating)
  useEffect(() => {
    if (!repId) return;
    const channel = supabase
      .channel(`daily-schedules-${repId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_schedules", filter: `rep_id=eq.${repId}` }, () => { fetchSchedule(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [repId, scheduleDate]);

  const fetchSchedule = async () => {
    if (!repId) return;
    setLoading(true);

    let hasCachedSchedule = false;

    try {
      const cached = await getCachedSchedule(repId, scheduleDate);
      if (cached) {
        hasCachedSchedule = true;
        setSchedule(cached);
        setItems((cached.schedule_items || []).sort((a: any, b: any) => a.sort_order - b.sort_order));
        setLoading(false);
      }
    } catch (cacheErr) {
      console.warn("[Schedule] Failed to read cached schedule:", cacheErr);
    }

    if (!navigator.onLine) {
      if (!hasCachedSchedule) {
        setSchedule(null);
        setItems([]);
        setLoading(false);
      }
      return;
    }

    try {
      const { data } = await supabase
        .from("daily_schedules")
        .select("*, schedule_items(*, customers(customer_name, account_number))")
        .eq("rep_id", repId)
        .eq("schedule_date", scheduleDate)
        .maybeSingle();

      if (data) {
        setSchedule(data);
        setItems((data.schedule_items || []).sort((a: any, b: any) => a.sort_order - b.sort_order));
        await setCachedSchedule(repId, scheduleDate, data);
      } else {
        setGenerating(true);
        const newId = await autoGenerateSchedule();
        setGenerating(false);

        if (newId) {
          const { data: newData } = await supabase
            .from("daily_schedules")
            .select("*, schedule_items(*, customers(customer_name, account_number))")
            .eq("id", newId)
            .maybeSingle();
          setSchedule(newData);
          setItems((newData?.schedule_items || []).sort((a: any, b: any) => a.sort_order - b.sort_order));
          if (newData) await setCachedSchedule(repId, scheduleDate, newData);
        } else {
          setSchedule(null);
          setItems([]);
        }
      }
    } catch (err) {
      console.warn("[Schedule] Online refresh failed, keeping cached schedule if available", err);
      if (!hasCachedSchedule) {
        setSchedule(null);
        setItems([]);
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchAdHocCustomers = async () => {
    if (!repId) return;

    const loadFromCache = async () => {
      try {
        const cached = await getCachedCustomers();
        if (cached.length > 0) {
          setAdHocCustomers(
            cached.map((c) => ({
              id: c.id,
              customer_name: c.customer_name,
              account_number: c.account_number,
              area: c.area,
              is_active: true,
            }))
          );
        }
      } catch {
        // Keep existing state
      }
    };

    await loadFromCache();
    if (!navigator.onLine) return;

    try {
      const { data } = await supabase
        .from("customer_assignments")
        .select("customer_id, customers(id, customer_name, account_number, area, is_active)")
        .eq("rep_id", repId);
      if (data) {
        const active = data.filter((d: any) => d.customers?.is_active).map((d: any) => d.customers);
        setAdHocCustomers(active);
        await setCachedCustomers(
          active.map((c: any) => ({
            id: c.id,
            customer_name: c.customer_name,
            account_number: c.account_number || null,
            area: c.area || null,
          }))
        );
      }
    } catch {
      // Online fetch failed, keep cached customers already loaded
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

  const submitAdHoc = async () => {
    if (!repId || !adHocCustomerId || !adHocArrival || !adHocLeaving) return;
    const dur = calcDuration(adHocArrival, adHocLeaving);
    if (dur <= 0) { toast.error("Leaving must be after arrival"); return; }
    setAdHocSubmitting(true);

    const customerName = adHocCustomers.find((c) => c.id === adHocCustomerId)?.customer_name;

    try {
      const { error } = await supabase.from("visits").insert({
        rep_id: repId,
        customer_id: adHocCustomerId,
        visit_date: scheduleDate,
        arrival_time: adHocArrival,
        leaving_time: adHocLeaving,
        duration_minutes: dur,
        notes: adHocNotes || null,
      });

      if (error) {
        if (isOfflineError(error)) {
          await saveVisitOffline(repId, adHocCustomerId, scheduleDate, adHocArrival, adHocLeaving, dur, adHocNotes || null, customerName);
          toast.success("Saved offline. Will sync when online.");
          resetAdHoc();
        } else {
          toast.error(error.message);
        }
      } else {
        toast.success("Ad-hoc visit logged");
        resetAdHoc();
      }
    } catch (err: any) {
      console.warn("[Schedule] Network error on ad-hoc:", err?.message);
      try {
        await saveVisitOffline(repId, adHocCustomerId, scheduleDate, adHocArrival, adHocLeaving, dur, adHocNotes || null, customerName);
        toast.success("Saved offline. Will sync when online.");
        resetAdHoc();
      } catch (idbErr) {
        console.error("[Schedule] IndexedDB save failed:", idbErr);
        toast.error("Failed to save visit. Please try again.");
      }
    }

    setAdHocSubmitting(false);
  };

  const resetAdHoc = () => {
    setAdHocOpen(false);
    setAdHocCustomerId("");
    setAdHocArrival("");
    setAdHocLeaving("");
    setAdHocNotes("");
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
            <Tabs defaultValue="schedule" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="schedule">
                  Schedule {items.filter(i => i.status === "pending" || (i.status !== "visited" && i.status !== "skipped")).length > 0 && `(${items.filter(i => i.status === "pending" || (i.status !== "visited" && i.status !== "skipped")).length})`}
                </TabsTrigger>
                <TabsTrigger value="completed">
                  Completed {items.filter(i => i.status === "visited" || i.status === "skipped").length > 0 && `(${items.filter(i => i.status === "visited" || i.status === "skipped").length})`}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="schedule" className="space-y-3 mt-3">
                {items.filter(i => i.status !== "visited" && i.status !== "skipped").length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">All visits completed for today!</p>
                ) : (
                  items.filter(i => i.status !== "visited" && i.status !== "skipped").map((item) => (
                    <ScheduleItemRow
                      key={item.id}
                      item={item}
                      repId={repId!}
                      scheduleDate={scheduleDate}
                      onRefresh={fetchSchedule}
                      onLocalUpdate={handleLocalUpdate}
                    />
                  ))
                )}
              </TabsContent>
              <TabsContent value="completed" className="space-y-3 mt-3">
                {items.filter(i => i.status === "visited" || i.status === "skipped").length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">No completed visits yet</p>
                ) : (
                  items.filter(i => i.status === "visited" || i.status === "skipped").map((item) => (
                    <ScheduleItemRow
                      key={item.id}
                      item={item}
                      repId={repId!}
                      scheduleDate={scheduleDate}
                      onRefresh={fetchSchedule}
                      onLocalUpdate={handleLocalUpdate}
                    />
                  ))
                )}
              </TabsContent>
            </Tabs>
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
