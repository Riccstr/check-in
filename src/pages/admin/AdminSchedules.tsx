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
import { Plus, Trash2, ArrowUp, ArrowDown, Settings, Search, GripVertical, ChevronDown } from "lucide-react";
import { A, PageHeader, Tag, PrimaryButton, GhostButton } from "@/lib/adminUi";

const WEEKDAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
];

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

  // Week management modal
  const [weekSettingsOpen, setWeekSettingsOpen] = useState(false);
  const [weekNameEdits, setWeekNameEdits] = useState<Record<string, string>>({});
  const [pendingCurrentWeek, setPendingCurrentWeek] = useState<number | null>(null);

  // Accordion expand state
  const [expandedWeekId, setExpandedWeekId] = useState<string | null>(null);

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

  useEffect(() => {
    fetchBaseData();
  }, []);

  useEffect(() => {
    if (selectedRep && selectedWeeklyTemplate) {
      fetchTemplates();
    }
  }, [selectedRep, selectedWeeklyTemplate]);

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

  // --- Week settings modal ---
  const openWeekSettings = () => {
    const edits: Record<string, string> = {};
    weeklyTemplates.forEach(w => { edits[w.id] = w.name; });
    setWeekNameEdits(edits);
    setPendingCurrentWeek(currentWeekOrder);
    setWeekSettingsOpen(true);
  };

  const saveWeekSettings = async () => {
    for (const wk of weeklyTemplates) {
      const newName = weekNameEdits[wk.id]?.trim();
      if (newName && newName !== wk.name) {
        const { error } = await supabase.from("weekly_templates").update({ name: newName }).eq("id", wk.id);
        if (error) { toast.error(error.message); return; }
      }
    }
    if (pendingCurrentWeek && pendingCurrentWeek !== currentWeekOrder) {
      await setCurrentWeek(pendingCurrentWeek);
    }
    setWeekSettingsOpen(false);
    fetchBaseData();
    toast.success("Week settings saved");
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

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 8px 8px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase", color: A.inkMute }}>4-Week Cycle</div>
            <button
              type="button"
              onClick={openWeekSettings}
              title="Manage weeks"
              style={{ padding: 3, background: "transparent", border: "none", color: A.inkMute, cursor: "pointer", display: "flex" }}
            >
              <Settings size={12} />
            </button>
          </div>
          {weeklyTemplates.map((wk) => {
            const sel = selectedWeeklyTemplate === wk.id;
            const isCurrent = wk.sort_order === currentWeekOrder;
            const isExpanded = expandedWeekId === wk.id;
            return (
              <div key={wk.id}>
                <div
                  onClick={() => { setSelectedWeeklyTemplate(wk.id); setExpandedWeekId(sel ? (isExpanded ? null : wk.id) : wk.id); }}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 10px", borderRadius: 8, border: `1px solid ${sel ? A.greenDeep : A.border}`, background: sel ? A.greenDeep : A.panel, cursor: "pointer", marginBottom: 0 }}
                >
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: sel ? A.cream : A.ink }}>{wk.name}</span>

                  {isCurrent && (
                    <span style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 7px", borderRadius: 5, background: sel ? A.green : A.greenSoft, color: sel ? A.cream : A.green, flexShrink: 0 }}>This week</span>
                  )}

                  <ChevronDown size={13} style={{ color: sel ? A.cream : A.inkMute, transition: "transform 0.2s", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", flexShrink: 0 }} />
                </div>
                {sel && isExpanded && (
                  <div style={{ display: "flex", gap: 2, padding: "6px 10px 6px 10px", background: A.panel, borderRadius: 6, margin: "6px 0" }}>
                    {WEEKDAYS.map((d) => {
                      const active = selectedDay === String(d.value);
                      return (
                        <button
                          key={d.value}
                          type="button"
                          onClick={() => setSelectedDay(String(d.value))}
                          style={{ flex: 1, padding: "4px 8px", borderRadius: 5, border: "none", background: active ? A.green : A.borderSoft, color: active ? A.cream : A.inkSoft, fontSize: 10.5, fontWeight: active ? 600 : 500, cursor: "pointer" }}
                        >
                          {d.label.slice(0, 3)}
                        </button>
                      );
                    })}
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
              {/* Header: rep · week */}
              <div style={{ display: "flex", alignItems: "center", padding: "14px 20px", borderBottom: `1px solid ${A.border}`, flexShrink: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {selectedRepName}
                  <span style={{ color: A.inkMute, fontWeight: 500 }}> · {selectedWeekName}</span>
                </div>
              </div>

              <div style={{ flex: 1, overflow: "auto", padding: "18px 20px" }}>
                {/* Single-day template */}
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
                        No stops for {dayLabel}. Click to build the route.
                      </div>
                    )}
                  </div>

                  <div style={{ fontSize: 11.5, color: A.inkMute, marginTop: 10 }}>
                    Editing opens the stop editor — saving regenerates future unstarted daily schedules for this rep + day. Past schedules and any day with an in-progress visit are untouched.
                  </div>
                </>
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

      {/* Week Settings Modal */}
      <Dialog open={weekSettingsOpen} onOpenChange={setWeekSettingsOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader><DialogTitle>Manage Week Cycle</DialogTitle></DialogHeader>
          <div className="space-y-2">
            {weeklyTemplates.slice().sort((a, b) => a.sort_order - b.sort_order).map((wk) => {
              const isCurrentPending = pendingCurrentWeek === wk.sort_order;
              return (
                <div
                  key={wk.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "12px 14px",
                    border: `1px solid ${isCurrentPending ? A.green : A.border}`,
                    background: isCurrentPending ? A.greenSoft : A.panelTint,
                    borderRadius: 8,
                  }}
                >
                  <Input
                    value={weekNameEdits[wk.id] || ""}
                    onChange={(e) => setWeekNameEdits({ ...weekNameEdits, [wk.id]: e.target.value })}
                    style={{ flex: 1, height: 28, fontSize: 12 }}
                  />
                  {isCurrentPending ? (
                    <span style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 7px", borderRadius: 5, background: A.green, color: A.cream, whiteSpace: "nowrap" }}>Current</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPendingCurrentWeek(wk.sort_order)}
                      style={{
                        padding: "4px 10px",
                        fontSize: 11,
                        fontWeight: 500,
                        border: `1px solid ${A.border}`,
                        background: A.panel,
                        color: A.inkSoft,
                        borderRadius: 5,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Set current
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWeekSettingsOpen(false)}>Cancel</Button>
            <Button onClick={saveWeekSettings}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}