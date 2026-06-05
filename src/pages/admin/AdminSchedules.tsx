import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { startOfWeek, subWeeks, format } from "date-fns";
import { Plus, Trash2, ArrowUp, ArrowDown, Settings, Search, GripVertical } from "lucide-react";
import { A, PageHeader, Tag, PrimaryButton, GhostButton } from "@/lib/adminUi";

const WEEKDAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
];

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface Rep {
  id: string;
  rep_name: string;
  surname: string | null;
  is_active: boolean;
}

interface Customer {
  id: string;
  customer_name: string;
  account_number: string | null;
  area: string | null;
  is_active: boolean;
}

interface WeeklyTemplate {
  id: string;
  name: string;
  sort_order: number;
}

interface ScheduleTemplateItem {
  id: string;
  customer_id: string;
  sort_order: number;
  customers: {
    customer_name: string;
    account_number: string | null;
    area: string | null;
  } | null;
}

interface ScheduleTemplate {
  id: string;
  rep_id: string;
  day_of_week: number;
  weekly_template_id: string;
  travel_time_minutes: number | null;
  is_active: boolean;
  created_at: string;
  schedule_template_items: ScheduleTemplateItem[];
}

interface ScheduleItem {
  id: string;
  sort_order: number;
  status: string;
  customers: {
    customer_name: string;
    account_number: string | null;
  } | null;
}

interface DailySchedule {
  id: string;
  schedule_date: string;
  schedule_items: ScheduleItem[];
}

export default function AdminSchedules() {
  const { user } = useAuth();
  const [reps, setReps] = useState<Rep[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedRep, setSelectedRep] = useState("");

  // Weekly templates (global)
  const [weeklyTemplates, setWeeklyTemplates] = useState<WeeklyTemplate[]>([]);
  const [currentWeekOrder, setCurrentWeekOrder] = useState<number>(1);

  // Schedule templates state (per rep per week per day)
  const [selectedWeeklyTemplate, setSelectedWeeklyTemplate] = useState("");
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([]);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateDay, setTemplateDay] = useState("1");
  const [templateTravelTime, setTemplateTravelTime] = useState<string>("");
  const [templateCustomers, setTemplateCustomers] = useState<string[]>([]);

  // Daily schedules
  const [dailySchedules, setDailySchedules] = useState<DailySchedule[]>([]);

  // Inline week rename
  const [editingWeekId, setEditingWeekId] = useState<string | null>(null);
  const [editingWeekName, setEditingWeekName] = useState("");

  // Template dialog filters
  const [customerSearch, setCustomerSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState("all");

  // ── View-only state (presentation; no data logic) ─────────────────────────
  // Which weekday tab is shown in the right pane, and whether the right pane is
  // showing the day template or the daily-schedule history.
  const [selectedDay, setSelectedDay] = useState<string>(() => {
    const d = new Date().getDay(); // 0 Sun .. 6 Sat
    return d >= 1 && d <= 5 ? String(d) : "1";
  });
  const [showDaily, setShowDaily] = useState(false);

  useEffect(() => {
    fetchBaseData();
  }, []);

  useEffect(() => {
    if (selectedRep && selectedWeeklyTemplate) {
      fetchTemplates();
    }
  }, [selectedRep, selectedWeeklyTemplate]);

  useEffect(() => {
    if (selectedRep) {
      fetchDailySchedules();
    }
  }, [selectedRep]);

  const fetchBaseData = async () => {
    const [repsRes, custRes, weekRes, settingRes] = await Promise.all([
      supabase.from("reps").select("id, rep_name, surname, is_active").eq("is_active", true).order("rep_name"),
      supabase.from("customers").select("id, customer_name, account_number, area, is_active").eq("is_active", true).order("customer_name"),
      supabase.from("weekly_templates").select("id, name, sort_order").order("sort_order"),
      supabase.from("app_settings").select("setting_key, setting_value").eq("setting_key", "current_week_order").maybeSingle(),
    ]);
    setReps(repsRes.data || []);
    setCustomers(custRes.data || []);
    const weeks = weekRes.data || [];
    setWeeklyTemplates(weeks);
    if (weeks.length > 0 && !selectedWeeklyTemplate) {
      setSelectedWeeklyTemplate(weeks[0].id);
    }
    // Auto-calculate current week based on today's date
    try {
      const today = new Date().toISOString().split("T")[0];
      const { data: weekOrder } = await supabase.rpc("get_week_order_for_date", { p_date: today });
      if (weekOrder && typeof weekOrder === "number") {
        const storedOrder = settingRes.data ? parseInt(settingRes.data.setting_value) || 1 : 1;
        if (weekOrder !== storedOrder) {
          await supabase
            .from("app_settings")
            .upsert({
              setting_key: "current_week_order",
              setting_value: String(weekOrder),
              updated_at: new Date().toISOString(),
              updated_by: user?.id || null,
            }, { onConflict: "setting_key" });
        }
        setCurrentWeekOrder(weekOrder);
      } else if (settingRes.data) {
        setCurrentWeekOrder(parseInt(settingRes.data.setting_value) || 1);
      }
    } catch (err) {
      console.warn("[Schedules] Failed to auto-calculate current week:", err);
      if (settingRes.data) {
        setCurrentWeekOrder(parseInt(settingRes.data.setting_value) || 1);
      }
    }
  };

  const fetchTemplates = async () => {
    if (!selectedRep || !selectedWeeklyTemplate) return;
    const { data } = await supabase
      .from("schedule_templates")
      .select("*, schedule_template_items(*, customers(customer_name, account_number, area))")
      .eq("rep_id", selectedRep)
      .eq("weekly_template_id", selectedWeeklyTemplate)
      .order("day_of_week");
    setTemplates(data || []);
  };

  const fetchDailySchedules = async () => {
    const { data } = await supabase
      .from("daily_schedules")
      .select("*, schedule_items(*, customers(customer_name, account_number))")
      .eq("rep_id", selectedRep)
      .order("schedule_date", { ascending: false })
      .limit(30);
    setDailySchedules(data || []);
  };


  // --- Current Week ---
  const setCurrentWeek = async (sortOrder: number) => {
    const thisMonday = startOfWeek(new Date(), { weekStartsOn: 1 });
    const newWeekCycleStart = subWeeks(thisMonday, sortOrder - 1);
    const anchorDateString = format(newWeekCycleStart, "yyyy-MM-dd");

    const { error } = await supabase.from("app_settings").upsert([
      { setting_key: "current_week_order", setting_value: String(sortOrder), updated_at: new Date().toISOString(), updated_by: user?.id },
      { setting_key: "week_cycle_start_date", setting_value: anchorDateString, updated_at: new Date().toISOString(), updated_by: user?.id },
    ], { onConflict: "setting_key" });
    if (error) toast.error(error.message);
    else {
      setCurrentWeekOrder(sortOrder);
      const wk = weeklyTemplates.find(w => w.sort_order === sortOrder);
      toast.success(`Current week set to ${wk?.name || sortOrder}`);
    }
  };

  // --- Reorder weeks ---
  const moveWeek = async (weekId: string, direction: "up" | "down") => {
    const idx = weeklyTemplates.findIndex(w => w.id === weekId);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= weeklyTemplates.length) return;

    const a = weeklyTemplates[idx];
    const b = weeklyTemplates[swapIdx];

    await Promise.all([
      supabase.from("weekly_templates").update({ sort_order: b.sort_order }).eq("id", a.id),
      supabase.from("weekly_templates").update({ sort_order: a.sort_order }).eq("id", b.id),
    ]);
    fetchBaseData();
  };

  // --- Inline week rename ---
  const startEditWeek = (wk: any) => {
    setEditingWeekId(wk.id);
    setEditingWeekName(wk.name);
  };

  const saveWeekName = async (id: string, name: string) => {
    const trimmed = name.trim();
    setEditingWeekId(null);
    if (!trimmed) return;
    const original = weeklyTemplates.find(w => w.id === id)?.name;
    if (trimmed === original) return;
    const { error } = await supabase.from("weekly_templates").update({ name: trimmed }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Week renamed"); fetchBaseData(); }
  };

  // --- Template CRUD ---
  const openNewTemplate = (day?: string) => {
    setTemplateDay(day || "1");
    setTemplateTravelTime("");
    setTemplateCustomers([]);
    setCustomerSearch("");
    setAreaFilter("all");
    setTemplateDialogOpen(true);
  };

  const moveCustomerInList = (index: number, direction: "up" | "down") => {
    const newList = [...templateCustomers];
    const swapIdx = direction === "up" ? index - 1 : index + 1;
    if (swapIdx < 0 || swapIdx >= newList.length) return;
    [newList[index], newList[swapIdx]] = [newList[swapIdx], newList[index]];
    setTemplateCustomers(newList);
  };

  const uniqueAreas = Array.from(new Set(customers.map(c => c.area).filter(Boolean))).sort();

  const filteredDialogCustomers = customers.filter(c => {
    const matchesSearch = !customerSearch || c.customer_name.toLowerCase().includes(customerSearch.toLowerCase());
    const matchesArea = areaFilter === "all" || c.area === areaFilter;
    return matchesSearch && matchesArea;
  });

  const saveTemplate = async () => {
    if (!selectedRep || !selectedWeeklyTemplate || templateCustomers.length === 0) {
      toast.error("Select at least one customer");
      return;
    }
    const day = parseInt(templateDay);
    const travelMins = templateTravelTime !== "" ? parseInt(templateTravelTime) : null;

    // Check if template exists for this rep/day/week
    const existing = templates.find(t => t.day_of_week === day);
    let templateId: string;

    if (existing) {
      templateId = existing.id;
      await supabase
        .from("schedule_templates")
        .update({ travel_time_minutes: travelMins })
        .eq("id", templateId);
    } else {
      const { data: tmpl, error } = await supabase
        .from("schedule_templates")
        .insert({ rep_id: selectedRep, day_of_week: day, weekly_template_id: selectedWeeklyTemplate, travel_time_minutes: travelMins })
        .select("id")
        .single();
      if (error) { toast.error(error.message); return; }
      templateId = tmpl.id;
    }

    // Replace items
    await supabase.from("schedule_template_items").delete().eq("template_id", templateId);
    const items = templateCustomers.map((cid, i) => ({
      template_id: templateId,
      customer_id: cid,
      sort_order: i,
    }));
    const { error: itemErr } = await supabase.from("schedule_template_items").insert(items);
    if (itemErr) toast.error(itemErr.message);
    else {
      toast.success(`${WEEKDAYS.find(d => d.value === day)?.label} template saved`);
      // Auto-regenerate: delete future daily schedules for this rep/day that have no started items
      await regenerateAffectedSchedules(selectedRep, day, selectedWeeklyTemplate);
    }

    setTemplateDialogOpen(false);
    fetchTemplates();
    if (selectedRep) fetchDailySchedules();
  };

  const regenerateAffectedSchedules = async (repId: string, dayOfWeek: number, weeklyTemplateId: string) => {
    const today = new Date().toISOString().split("T")[0];
    // Find daily schedules for this rep from today onwards
    const { data: schedules } = await supabase
      .from("daily_schedules")
      .select("id, schedule_date, schedule_items(id, status)")
      .eq("rep_id", repId)
      .gte("schedule_date", today);

    if (!schedules) return;

    for (const ds of schedules) {
      // Check if this schedule's date matches the day of week
      const schedDow = new Date(ds.schedule_date + "T12:00:00").getDay();
      // Convert JS getDay (0=Sun) to ISO (1=Mon..7=Sun)
      const isoDow = schedDow === 0 ? 7 : schedDow;
      if (isoDow !== dayOfWeek) continue;

      // Only delete if no items have been visited or skipped (not started)
      const items = ds.schedule_items || [];
      const hasStarted = items.some((i: any) => i.status === "visited" || i.status === "skipped" || i.arrival_time);
      if (hasStarted) continue;

      // Delete the schedule (cascade deletes items) — rep's realtime will auto-regenerate
      await supabase.from("daily_schedules").delete().eq("id", ds.id);
    }
  };

  const editTemplate = (t: any) => {
    setTemplateDay(String(t.day_of_week));
    setTemplateTravelTime(t.travel_time_minutes != null ? String(t.travel_time_minutes) : "");
    setTemplateCustomers(t.schedule_template_items?.sort((a: any, b: any) => a.sort_order - b.sort_order).map((i: any) => i.customer_id) || []);
    setCustomerSearch("");
    setAreaFilter("all");
    setTemplateDialogOpen(true);
  };

  const deleteTemplate = async (id: string) => {
    if (!confirm("Delete this day template? This will also remove future unstarted schedules for this day.")) return;
    await supabase.from("schedule_templates").delete().eq("id", id);
    toast.success("Template deleted");
    fetchTemplates();
  };

  // --- Daily schedules ---
  const deleteDaily = async (id: string) => {
    if (!confirm("Delete this daily schedule? This cannot be undone.")) return;
    await supabase.from("daily_schedules").delete().eq("id", id);
    toast.success("Schedule deleted");
    fetchDailySchedules();
  };

  const toggleCustomer = (list: string[], setList: (v: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter(c => c !== id) : [...list, id]);
  };

  // ── Derived (presentation only) ───────────────────────────────────────────
  const selectedRepObj = reps.find((r) => r.id === selectedRep);
  const selectedRepName = selectedRepObj
    ? `${selectedRepObj.rep_name}${selectedRepObj.surname ? " " + selectedRepObj.surname : ""}`
    : "";
  const selectedWeekName = weeklyTemplates.find((w) => w.id === selectedWeeklyTemplate)?.name ?? "";

  const dayNum = parseInt(selectedDay);
  const dayLabel = WEEKDAYS.find((d) => d.value === dayNum)?.label ?? "";
  const dayTemplate = templates.find((t) => t.day_of_week === dayNum);
  const dayItems = dayTemplate?.schedule_template_items?.slice().sort((a, b) => a.sort_order - b.sort_order) || [];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: A.bg, minHeight: 0, fontFamily: A.sans, color: A.ink }}>
      <PageHeader
        title="Schedules"
        subtitle={`4-week rotation · ${weeklyTemplates.find((w) => w.sort_order === currentWeekOrder)?.name ?? "—"} is current`}
        right={
          <>
            <GhostButton icon={<Settings size={13} />}>Print week</GhostButton>
            <PrimaryButton icon={<Plus size={13} />} onClick={() => openNewTemplate(selectedDay)} disabled={!selectedRep}>
              New day template
            </PrimaryButton>
          </>
        }
      />

      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>

        {/* ── Left rail: reps + 4-week cycle ──────────────────────────────── */}
        <div style={{ width: 264, flexShrink: 0, borderRight: `1px solid ${A.border}`, background: A.panelTint, overflowY: "auto", padding: "12px 10px" }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase", color: A.inkMute, padding: "4px 8px 8px" }}>Reps</div>
          {reps.length === 0 ? (
            <div style={{ padding: "8px 10px", fontSize: 12, color: A.inkMute }}>No active reps.</div>
          ) : reps.map((r) => {
            const sel = selectedRep === r.id;
            const initials = `${r.rep_name?.[0] ?? ""}${r.surname?.[0] ?? ""}`.toUpperCase() || (r.rep_name?.slice(0, 2).toUpperCase() ?? "?");
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedRep(r.id)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, border: "none", background: sel ? A.greenSoft : "transparent", cursor: "pointer", textAlign: "left", marginBottom: 2 }}
              >
                <span style={{ width: 26, height: 26, borderRadius: 999, background: sel ? A.green : A.borderSoft, color: sel ? A.cream : A.inkSoft, fontSize: 10.5, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{initials}</span>
                <span style={{ fontSize: 13, fontWeight: sel ? 600 : 500, color: sel ? A.green : A.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.rep_name}{r.surname ? ` ${r.surname}` : ""}</span>
              </button>
            );
          })}

          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase", color: A.inkMute, padding: "18px 8px 8px" }}>4-Week Cycle</div>
          {weeklyTemplates.map((wk, idx) => {
            const sel = selectedWeeklyTemplate === wk.id;
            const isCurrent = wk.sort_order === currentWeekOrder;
            const editing = editingWeekId === wk.id;
            return (
              <div
                key={wk.id}
                className="group"
                onClick={() => { if (!editing) setSelectedWeeklyTemplate(wk.id); }}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 10px", borderRadius: 8, border: `1px solid ${sel ? A.greenDeep : A.border}`, background: sel ? A.greenDeep : A.panel, cursor: "pointer", marginBottom: 6 }}
              >
                {editing ? (
                  <Input
                    autoFocus
                    value={editingWeekName}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setEditingWeekName(e.target.value)}
                    onBlur={() => saveWeekName(wk.id, editingWeekName)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                      if (e.key === "Escape") setEditingWeekId(null);
                    }}
                    style={{ height: 24, fontSize: 12.5, fontWeight: 600, padding: "0 6px", flex: 1 }}
                  />
                ) : (
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: sel ? A.cream : A.ink }}>{wk.name}</span>
                )}

                {!editing && isCurrent && (
                  <span style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 7px", borderRadius: 5, background: sel ? A.green : A.greenSoft, color: sel ? A.cream : A.green, flexShrink: 0 }}>This week</span>
                )}

                {!editing && (
                  <div
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!isCurrent && (
                      <button type="button" title="Set as current week" onClick={() => setCurrentWeek(wk.sort_order)} style={{ padding: "2px 6px", fontSize: 9.5, fontWeight: 600, border: `1px solid ${sel ? A.cream : A.border}`, background: sel ? "transparent" : A.panel, color: sel ? A.cream : A.inkSoft, borderRadius: 5, cursor: "pointer" }}>Set current</button>
                    )}
                    <button type="button" title="Rename" onClick={() => startEditWeek(wk)} style={{ padding: 3, background: "transparent", border: "none", color: sel ? A.cream : A.inkMute, cursor: "pointer", display: "flex" }}>
                      <Settings size={11} />
                    </button>
                    <button type="button" title="Move earlier" disabled={idx === 0} onClick={() => moveWeek(wk.id, "up")} style={{ padding: 3, background: "transparent", border: "none", color: idx === 0 ? A.inkDim : (sel ? A.cream : A.inkMute), cursor: idx === 0 ? "not-allowed" : "pointer", display: "flex" }}>
                      <ArrowUp size={11} />
                    </button>
                    <button type="button" title="Move later" disabled={idx === weeklyTemplates.length - 1} onClick={() => moveWeek(wk.id, "down")} style={{ padding: 3, background: "transparent", border: "none", color: idx === weeklyTemplates.length - 1 ? A.inkDim : (sel ? A.cream : A.inkMute), cursor: idx === weeklyTemplates.length - 1 ? "not-allowed" : "pointer", display: "flex" }}>
                      <ArrowDown size={11} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Right pane: day template (or daily history) ─────────────────── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
          {!selectedRep ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: A.inkMute, fontSize: 13, padding: 24, textAlign: "center" }}>
              Select a rep to view and edit their schedule.
            </div>
          ) : !selectedWeeklyTemplate ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: A.inkMute, fontSize: 13 }}>
              Select a week from the cycle.
            </div>
          ) : (
            <>
              {/* Header: rep · week  +  day tabs + daily-history toggle */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: `1px solid ${A.border}`, flexShrink: 0, gap: 12 }}>
                <div style={{ fontSize: 15, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {selectedRepName}
                  <span style={{ color: A.inkMute, fontWeight: 500 }}> · {selectedWeekName}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <div style={{ display: "flex", gap: 2, background: A.borderSoft, padding: 3, borderRadius: 8 }}>
                    {WEEKDAYS.map((d) => {
                      const active = !showDaily && selectedDay === String(d.value);
                      return (
                        <button
                          key={d.value}
                          type="button"
                          onClick={() => { setShowDaily(false); setSelectedDay(String(d.value)); }}
                          style={{ padding: "4px 12px", borderRadius: 6, border: "none", background: active ? A.panel : "transparent", color: active ? A.ink : A.inkSoft, fontSize: 12, fontWeight: active ? 600 : 500, cursor: "pointer", boxShadow: active ? "0 1px 2px rgba(23,23,21,0.06)" : "none" }}
                        >
                          {d.label.slice(0, 3)}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowDaily((s) => !s)}
                    style={{ padding: "6px 11px", borderRadius: 7, border: `1px solid ${showDaily ? A.green : A.border}`, background: showDaily ? A.greenSoft : A.panel, color: showDaily ? A.green : A.inkSoft, fontSize: 11.5, fontWeight: 500, cursor: "pointer" }}
                  >
                    Daily history
                  </button>
                </div>
              </div>

              <div style={{ flex: 1, overflow: "auto", padding: "18px 20px" }}>
                {showDaily ? (
                  /* ── Daily schedule history ─────────────────────────── */
                  <div style={{ background: A.panel, border: `1px solid ${A.border}`, borderRadius: 10, overflow: "hidden" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "120px 100px 1fr 130px 60px", padding: "10px 14px", fontSize: 10.5, color: A.inkMute, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", borderBottom: `1px solid ${A.borderSoft}`, background: A.panelTint }}>
                      <div>Date</div>
                      <div>Day</div>
                      <div>Customers</div>
                      <div>Status</div>
                      <div></div>
                    </div>
                    {dailySchedules.length === 0 ? (
                      <div style={{ padding: "40px 16px", textAlign: "center", color: A.inkMute, fontSize: 13 }}>No schedules generated yet for this rep.</div>
                    ) : dailySchedules.map((ds, rowIdx) => {
                      const items = (ds.schedule_items || []).slice().sort((a, b) => a.sort_order - b.sort_order);
                      const visited = items.filter((i) => i.status === "visited").length;
                      const pct = items.length > 0 ? Math.round((visited / items.length) * 100) : 0;
                      return (
                        <div key={ds.id} style={{ display: "grid", gridTemplateColumns: "120px 100px 1fr 130px 60px", padding: "11px 14px", alignItems: "flex-start", borderBottom: rowIdx < dailySchedules.length - 1 ? `1px solid ${A.borderRow}` : "none", fontSize: 12 }}>
                          <div style={{ fontFamily: A.mono, fontWeight: 500 }}>{ds.schedule_date}</div>
                          <div>{DAYS[new Date(ds.schedule_date + "T12:00:00").getDay()]}</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            {items.map((i, idx) => (
                              <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
                                <span style={{ flexShrink: 0, width: 16, height: 16, borderRadius: 999, background: i.status === "visited" ? A.green : i.status === "skipped" ? A.dangerBg : A.borderSoft, color: i.status === "visited" ? A.cream : i.status === "skipped" ? A.danger : A.inkSoft, fontFamily: A.mono, fontSize: 9.5, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>{idx + 1}</span>
                                <span style={{ color: i.status === "skipped" ? A.inkMute : A.ink, textDecoration: i.status === "skipped" ? "line-through" : "none" }}>{i.customers?.customer_name}</span>
                              </div>
                            ))}
                          </div>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <div style={{ flex: 1, height: 4, background: A.borderSoft, borderRadius: 999, overflow: "hidden" }}>
                                <div style={{ width: `${pct}%`, height: "100%", background: A.green, borderRadius: 999 }} />
                              </div>
                              <div style={{ fontFamily: A.mono, fontSize: 11, color: A.inkSoft, minWidth: 32, textAlign: "right" }}>{visited}/{items.length}</div>
                            </div>
                          </div>
                          <div style={{ display: "flex", justifyContent: "flex-end" }}>
                            <button type="button" onClick={() => deleteDaily(ds.id)} title="Delete schedule" style={{ padding: 5, background: "transparent", border: "none", color: A.danger, cursor: "pointer" }}>
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* ── Single-day template ────────────────────────────── */
                  <>
                    <div style={{ background: A.panel, border: `1px solid ${A.border}`, borderRadius: 12, overflow: "hidden" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: `1px solid ${A.border}` }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>
                          {dayLabel.slice(0, 3)} <span style={{ color: A.inkMute, fontWeight: 500 }}>· {dayItems.length} {dayItems.length === 1 ? "stop" : "stops"}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {dayTemplate && (
                            <button type="button" onClick={() => deleteTemplate(dayTemplate.id)} title="Delete day template" style={{ padding: "6px 8px", background: "transparent", border: `1px solid ${A.border}`, borderRadius: 6, color: A.danger, cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
                              <Trash2 size={13} />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => (dayTemplate ? editTemplate(dayTemplate) : openNewTemplate(selectedDay))}
                            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 13px", background: A.green, color: A.cream, border: "none", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: `0 1px 0 ${A.greenDeep}` }}
                          >
                            <Plus size={13} /> {dayTemplate ? "Edit stops" : "Add stop"}
                          </button>
                        </div>
                      </div>

                      {dayItems.length > 0 ? (
                        dayItems.map((i, idx) => (
                          <div key={i.id} style={{ display: "grid", gridTemplateColumns: "30px 44px 1fr 120px 130px", alignItems: "center", padding: "12px 16px", borderBottom: idx < dayItems.length - 1 ? `1px solid ${A.borderRow}` : "none", fontSize: 13 }}>
                            <span style={{ color: A.inkDim, display: "flex" }}><GripVertical size={14} /></span>
                            <span style={{ fontFamily: A.mono, fontSize: 12, color: A.inkMute }}>{String(idx + 1).padStart(2, "0")}</span>
                            <span style={{ fontWeight: 500, color: A.ink }}>{i.customers?.customer_name}</span>
                            <span style={{ fontFamily: A.mono, fontSize: 11.5, color: A.inkSoft }}>{i.customers?.account_number ? `#${i.customers.account_number}` : "—"}</span>
                            <span style={{ display: "flex", justifyContent: "flex-start" }}>{i.customers?.area ? <Tag tone="cream">{i.customers.area}</Tag> : null}</span>
                          </div>
                        ))
                      ) : (
                        <div style={{ padding: "48px 16px", textAlign: "center", color: A.inkMute, fontSize: 13 }}>
                          No stops for {dayLabel}. Click {dayTemplate ? "\u201CEdit stops\u201D" : "\u201CAdd stop\u201D"} to build the route.
                        </div>
                      )}
                    </div>

                    <div style={{ fontSize: 11.5, color: A.inkMute, marginTop: 10 }}>
                      Editing opens the stop editor — saving regenerates future unstarted daily schedules for this rep + day. Past schedules and any day with an in-progress visit are untouched.
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Template Dialog */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Day Template — {weeklyTemplates.find(w => w.id === selectedWeeklyTemplate)?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Day of Week</Label>
              <Select value={templateDay} onValueChange={setTemplateDay}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map(d => (<SelectItem key={d.value} value={String(d.value)}>{d.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Travel Time (minutes)</Label>
              <Input
                type="number"
                min={0}
                step={1}
                placeholder="e.g. 120"
                value={templateTravelTime}
                onChange={(e) => setTemplateTravelTime(e.target.value)}
              />
            </div>

            {/* Selected customers with reorder */}
            {templateCustomers.length > 0 && (
              <div>
                <Label className="text-sm font-medium">Selected ({templateCustomers.length}) — drag order</Label>
                <div className="border rounded-md p-2 space-y-1 mt-1 max-h-40 overflow-y-auto">
                  {templateCustomers.map((cid, idx) => {
                    const cust = customers.find(c => c.id === cid);
                    return (
                      <div key={cid} className="flex items-center gap-1 py-0.5 px-2 rounded bg-muted text-xs">
                        <GripVertical className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="flex-1 truncate">{cust?.account_number ? `(${cust.account_number}) ` : ""}{cust?.customer_name}{cust?.area ? ` — ${cust.area}` : ""}</span>
                        <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === 0} onClick={() => moveCustomerInList(idx, "up")}>
                          <ArrowUp className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === templateCustomers.length - 1} onClick={() => moveCustomerInList(idx, "down")}>
                          <ArrowDown className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setTemplateCustomers(templateCustomers.filter(id => id !== cid))}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Search & filter */}
            <div>
              <Label>Customers</Label>
              <div className="flex gap-2 mt-1">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search customers..."
                    value={customerSearch}
                    onChange={e => setCustomerSearch(e.target.value)}
                    className="pl-8"
                  />
                </div>
                <Select value={areaFilter} onValueChange={setAreaFilter}>
                  <SelectTrigger className="w-[140px]"><SelectValue placeholder="All areas" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All areas</SelectItem>
                    {uniqueAreas.map(a => (
                      <SelectItem key={a} value={a!}>{a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="border rounded-md p-1.5 space-y-0.5 max-h-48 overflow-y-auto mt-1">
                {filteredDialogCustomers.map(c => (
                  <label key={c.id} className="flex items-center gap-2 py-0.5 px-2 rounded hover:bg-muted cursor-pointer">
                    <Checkbox
                      checked={templateCustomers.includes(c.id)}
                      onCheckedChange={() => toggleCustomer(templateCustomers, setTemplateCustomers, c.id)}
                    />
                    <span className="text-xs">{c.account_number ? `(${c.account_number}) ` : ""}{c.customer_name}</span>
                    {c.area && <span className="text-[11px] text-muted-foreground">— {c.area}</span>}
                  </label>
                ))}
                {filteredDialogCustomers.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-2">No customers found</p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter><Button onClick={saveTemplate}>Save Template</Button></DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}