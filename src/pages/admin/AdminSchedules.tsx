import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { CalendarDays, Plus, Trash2, ArrowUp, ArrowDown, Settings } from "lucide-react";

const WEEKDAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
];

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function AdminSchedules() {
  const { user } = useAuth();
  const [reps, setReps] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [selectedRep, setSelectedRep] = useState("");

  // Weekly templates (global)
  const [weeklyTemplates, setWeeklyTemplates] = useState<any[]>([]);
  const [currentWeekOrder, setCurrentWeekOrder] = useState<number>(1);

  // Schedule templates state (per rep per week per day)
  const [selectedWeeklyTemplate, setSelectedWeeklyTemplate] = useState("");
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateDay, setTemplateDay] = useState("1");
  const [templateCustomers, setTemplateCustomers] = useState<string[]>([]);

  // Daily schedules
  const [dailySchedules, setDailySchedules] = useState<any[]>([]);

  // Week rename
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameWeekId, setRenameWeekId] = useState("");
  const [renameValue, setRenameValue] = useState("");

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
      supabase.from("reps").select("*").eq("is_active", true).order("rep_name"),
      supabase.from("customers").select("*").eq("is_active", true).order("customer_name"),
      supabase.from("weekly_templates").select("*").order("sort_order"),
      supabase.from("app_settings").select("*").eq("setting_key", "current_week_order").maybeSingle(),
    ]);
    setReps(repsRes.data || []);
    setCustomers(custRes.data || []);
    const weeks = weekRes.data || [];
    setWeeklyTemplates(weeks);
    if (weeks.length > 0 && !selectedWeeklyTemplate) {
      setSelectedWeeklyTemplate(weeks[0].id);
    }
    if (settingRes.data) {
      setCurrentWeekOrder(parseInt(settingRes.data.setting_value) || 1);
    }
  };

  const fetchTemplates = async () => {
    if (!selectedRep || !selectedWeeklyTemplate) return;
    const { data } = await supabase
      .from("schedule_templates")
      .select("*, schedule_template_items(*, customers(customer_name))")
      .eq("rep_id", selectedRep)
      .eq("weekly_template_id", selectedWeeklyTemplate)
      .order("day_of_week");
    setTemplates(data || []);
  };

  const fetchDailySchedules = async () => {
    const { data } = await supabase
      .from("daily_schedules")
      .select("*, schedule_items(*, customers(customer_name))")
      .eq("rep_id", selectedRep)
      .order("schedule_date", { ascending: false })
      .limit(30);
    setDailySchedules(data || []);
  };

  // --- Current Week ---
  const setCurrentWeek = async (sortOrder: number) => {
    const { error } = await supabase
      .from("app_settings")
      .update({ setting_value: String(sortOrder), updated_at: new Date().toISOString(), updated_by: user?.id })
      .eq("setting_key", "current_week_order");
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

  // --- Rename week ---
  const openRename = (wk: any) => {
    setRenameWeekId(wk.id);
    setRenameValue(wk.name);
    setRenameDialogOpen(true);
  };

  const saveRename = async () => {
    if (!renameValue.trim()) return;
    await supabase.from("weekly_templates").update({ name: renameValue.trim() }).eq("id", renameWeekId);
    toast.success("Week renamed");
    setRenameDialogOpen(false);
    fetchBaseData();
  };

  // --- Template CRUD ---
  const openNewTemplate = () => {
    setTemplateDay("1");
    setTemplateCustomers([]);
    setTemplateDialogOpen(true);
  };

  const saveTemplate = async () => {
    if (!selectedRep || !selectedWeeklyTemplate || templateCustomers.length === 0) {
      toast.error("Select at least one customer");
      return;
    }
    const day = parseInt(templateDay);

    // Check if template exists for this rep/day/week
    const existing = templates.find(t => t.day_of_week === day);
    let templateId: string;

    if (existing) {
      templateId = existing.id;
    } else {
      const { data: tmpl, error } = await supabase
        .from("schedule_templates")
        .insert({ rep_id: selectedRep, day_of_week: day, weekly_template_id: selectedWeeklyTemplate })
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
    else toast.success(`${WEEKDAYS.find(d => d.value === day)?.label} template saved`);

    setTemplateDialogOpen(false);
    fetchTemplates();
  };

  const editTemplate = (t: any) => {
    setTemplateDay(String(t.day_of_week));
    setTemplateCustomers(t.schedule_template_items?.map((i: any) => i.customer_id) || []);
    setTemplateDialogOpen(true);
  };

  const deleteTemplate = async (id: string) => {
    await supabase.from("schedule_templates").delete().eq("id", id);
    toast.success("Template deleted");
    fetchTemplates();
  };

  // --- Daily schedules ---
  const deleteDaily = async (id: string) => {
    await supabase.from("daily_schedules").delete().eq("id", id);
    toast.success("Schedule deleted");
    fetchDailySchedules();
  };

  const toggleCustomer = (list: string[], setList: (v: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter(c => c !== id) : [...list, id]);
  };

  return (
    <div className="space-y-4">
      {/* Current Week Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5 text-accent" /> Week Rotation Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-sm font-medium">Current Week</Label>
            <Select value={String(currentWeekOrder)} onValueChange={(v) => setCurrentWeek(parseInt(v))}>
              <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {weeklyTemplates.map(w => (
                  <SelectItem key={w.id} value={String(w.sort_order)}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-sm font-medium mb-2 block">Week Order & Names</Label>
            <div className="space-y-2">
              {weeklyTemplates.map((wk, idx) => (
                <div key={wk.id} className="flex items-center gap-2 p-2 border rounded-md">
                  <span className="font-mono text-sm text-muted-foreground w-6">{wk.sort_order}.</span>
                  <span className="font-medium flex-1">{wk.name}</span>
                  {wk.sort_order === currentWeekOrder && (
                    <Badge variant="default" className="text-xs">Current</Badge>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openRename(wk)}>
                    <Settings className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={idx === 0} onClick={() => moveWeek(wk.id, "up")}>
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={idx === weeklyTemplates.length - 1} onClick={() => moveWeek(wk.id, "down")}>
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Rep Schedule Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-accent" /> Rep Schedules</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <Label>Select Rep</Label>
            <Select value={selectedRep} onValueChange={setSelectedRep}>
              <SelectTrigger className="max-w-xs"><SelectValue placeholder="Choose a rep" /></SelectTrigger>
              <SelectContent>
                {reps.map(r => (
                  <SelectItem key={r.id} value={r.id}>{r.rep_name} {r.surname || ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedRep && (
            <Tabs defaultValue="templates">
              <TabsList>
                <TabsTrigger value="templates">Weekly Templates</TabsTrigger>
                <TabsTrigger value="daily">Daily Schedules</TabsTrigger>
              </TabsList>

              <TabsContent value="templates" className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Label className="text-sm">Week:</Label>
                  {weeklyTemplates.map(w => (
                    <Button
                      key={w.id}
                      variant={selectedWeeklyTemplate === w.id ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSelectedWeeklyTemplate(w.id)}
                    >
                      {w.name}
                    </Button>
                  ))}
                </div>

                <Button size="sm" onClick={openNewTemplate}><Plus className="h-4 w-4 mr-1" /> Add Day Template</Button>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Day</TableHead>
                      <TableHead>Customers</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {templates.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{WEEKDAYS.find(d => d.value === t.day_of_week)?.label || `Day ${t.day_of_week}`}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {t.schedule_template_items?.map((i: any) => (
                              <Badge key={i.id} variant="secondary" className="text-xs">{i.customers?.customer_name}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button variant="ghost" size="sm" onClick={() => editTemplate(t)}>Edit</Button>
                          <Button variant="ghost" size="icon" onClick={() => deleteTemplate(t.id)}><Trash2 className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {templates.length === 0 && (
                      <TableRow><TableCell colSpan={3} className="text-muted-foreground text-center py-4">No templates for this week yet</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </TabsContent>

              <TabsContent value="daily" className="space-y-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Day</TableHead>
                      <TableHead>Customers</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dailySchedules.map(ds => {
                      const items = ds.schedule_items || [];
                      const visited = items.filter((i: any) => i.status === "visited").length;
                      return (
                        <TableRow key={ds.id}>
                          <TableCell className="font-medium">{ds.schedule_date}</TableCell>
                          <TableCell>{DAYS[new Date(ds.schedule_date + "T12:00:00").getDay()]}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {items.map((i: any) => (
                                <Badge key={i.id} variant={i.status === "visited" ? "default" : "secondary"} className="text-xs">
                                  {i.customers?.customer_name}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{visited}/{items.length} visited</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" onClick={() => deleteDaily(ds.id)}><Trash2 className="h-4 w-4" /></Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {dailySchedules.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-muted-foreground text-center py-4">No schedules yet</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>

      {/* Template Dialog */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
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
              <Label>Customers</Label>
              <div className="border rounded-md p-2 space-y-1 max-h-60 overflow-y-auto mt-1">
                {customers.map(c => (
                  <label key={c.id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted cursor-pointer">
                    <Checkbox
                      checked={templateCustomers.includes(c.id)}
                      onCheckedChange={() => toggleCustomer(templateCustomers, setTemplateCustomers, c.id)}
                    />
                    <span className="text-sm">{c.customer_name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter><Button onClick={saveTemplate}>Save Template</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename Week</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label>Name</Label>
            <Input value={renameValue} onChange={e => setRenameValue(e.target.value)} />
          </div>
          <DialogFooter><Button onClick={saveRename}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
