import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { CalendarDays, Plus, Trash2, Copy } from "lucide-react";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function AdminSchedules() {
  const [reps, setReps] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [selectedRep, setSelectedRep] = useState("");

  // Templates state
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateDay, setTemplateDay] = useState("1");
  const [templateCustomers, setTemplateCustomers] = useState<string[]>([]);

  // Daily schedule state
  const [dailySchedules, setDailySchedules] = useState<any[]>([]);
  const [dailyDialogOpen, setDailyDialogOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().split("T")[0]);
  const [dailyCustomers, setDailyCustomers] = useState<string[]>([]);
  const [generatingFromTemplate, setGeneratingFromTemplate] = useState(false);

  useEffect(() => {
    supabase.from("reps").select("*").eq("is_active", true).order("rep_name").then(({ data }) => setReps(data || []));
    supabase.from("customers").select("*").eq("is_active", true).order("customer_name").then(({ data }) => setCustomers(data || []));
  }, []);

  useEffect(() => {
    if (selectedRep) {
      fetchTemplates();
      fetchDailySchedules();
    }
  }, [selectedRep]);

  const fetchTemplates = async () => {
    const { data } = await supabase
      .from("schedule_templates")
      .select("*, schedule_template_items(*, customers(customer_name))")
      .eq("rep_id", selectedRep)
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

  const openNewTemplate = () => {
    setTemplateDay("1");
    setTemplateCustomers([]);
    setTemplateDialogOpen(true);
  };

  const saveTemplate = async () => {
    if (!selectedRep || templateCustomers.length === 0) {
      toast.error("Select at least one customer");
      return;
    }
    const day = parseInt(templateDay);

    // Upsert template
    const { data: tmpl, error: tmplErr } = await supabase
      .from("schedule_templates")
      .upsert({ rep_id: selectedRep, day_of_week: day }, { onConflict: "rep_id,day_of_week" })
      .select()
      .single();

    if (tmplErr) { toast.error(tmplErr.message); return; }

    // Delete existing items and insert new
    await supabase.from("schedule_template_items").delete().eq("template_id", tmpl.id);
    const items = templateCustomers.map((cid, i) => ({
      template_id: tmpl.id,
      customer_id: cid,
      sort_order: i,
    }));
    const { error: itemErr } = await supabase.from("schedule_template_items").insert(items);
    if (itemErr) toast.error(itemErr.message);
    else toast.success(`${DAYS[day]} template saved`);

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

  // Daily schedules
  const openNewDaily = () => {
    setScheduleDate(new Date().toISOString().split("T")[0]);
    setDailyCustomers([]);
    setDailyDialogOpen(true);
  };

  const generateFromTemplate = async () => {
    if (!selectedRep || !scheduleDate) return;
    setGeneratingFromTemplate(true);
    const dayOfWeek = new Date(scheduleDate + "T12:00:00").getDay();
    const template = templates.find((t) => t.day_of_week === dayOfWeek);
    if (template) {
      setDailyCustomers(template.schedule_template_items?.map((i: any) => i.customer_id) || []);
      toast.success(`Loaded ${DAYS[dayOfWeek]} template`);
    } else {
      toast.info(`No template for ${DAYS[dayOfWeek]}`);
    }
    setGeneratingFromTemplate(false);
  };

  const saveDaily = async () => {
    if (!selectedRep || !scheduleDate || dailyCustomers.length === 0) {
      toast.error("Select date and at least one customer");
      return;
    }

    // Upsert daily schedule
    const { data: sched, error: schedErr } = await supabase
      .from("daily_schedules")
      .upsert({ rep_id: selectedRep, schedule_date: scheduleDate }, { onConflict: "rep_id,schedule_date" })
      .select()
      .single();

    if (schedErr) { toast.error(schedErr.message); return; }

    // Delete existing items and insert new
    await supabase.from("schedule_items").delete().eq("schedule_id", sched.id);
    const items = dailyCustomers.map((cid, i) => ({
      schedule_id: sched.id,
      customer_id: cid,
      sort_order: i,
    }));
    const { error: itemErr } = await supabase.from("schedule_items").insert(items);
    if (itemErr) toast.error(itemErr.message);
    else toast.success("Schedule saved");

    setDailyDialogOpen(false);
    fetchDailySchedules();
  };

  const deleteDaily = async (id: string) => {
    await supabase.from("daily_schedules").delete().eq("id", id);
    toast.success("Schedule deleted");
    fetchDailySchedules();
  };

  const toggleCustomer = (list: string[], setList: (v: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter((c) => c !== id) : [...list, id]);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-accent" /> Schedules</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <Label>Select Rep</Label>
            <Select value={selectedRep} onValueChange={setSelectedRep}>
              <SelectTrigger className="max-w-xs"><SelectValue placeholder="Choose a rep" /></SelectTrigger>
              <SelectContent>
                {reps.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.rep_name} {r.surname || ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedRep && (
            <Tabs defaultValue="daily">
              <TabsList>
                <TabsTrigger value="daily">Daily Schedules</TabsTrigger>
                <TabsTrigger value="templates">Weekly Templates</TabsTrigger>
              </TabsList>

              <TabsContent value="daily" className="space-y-3">
                <Button size="sm" onClick={openNewDaily}><Plus className="h-4 w-4 mr-1" /> New Schedule</Button>
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
                    {dailySchedules.map((ds) => {
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

              <TabsContent value="templates" className="space-y-3">
                <Button size="sm" onClick={openNewTemplate}><Plus className="h-4 w-4 mr-1" /> New Template</Button>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Day</TableHead>
                      <TableHead>Customers</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {templates.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{DAYS[t.day_of_week]}</TableCell>
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
                      <TableRow><TableCell colSpan={3} className="text-muted-foreground text-center py-4">No templates yet</TableCell></TableRow>
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
          <DialogHeader><DialogTitle>Weekly Template</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Day of Week</Label>
              <Select value={templateDay} onValueChange={setTemplateDay}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DAYS.map((d, i) => (<SelectItem key={i} value={String(i)}>{d}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Customers</Label>
              <div className="border rounded-md p-2 space-y-1 max-h-60 overflow-y-auto mt-1">
                {customers.map((c) => (
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

      {/* Daily Schedule Dialog */}
      <Dialog open={dailyDialogOpen} onOpenChange={setDailyDialogOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Daily Schedule</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Date</Label>
              <Input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} />
            </div>
            <Button variant="outline" size="sm" onClick={generateFromTemplate} disabled={generatingFromTemplate}>
              <Copy className="h-4 w-4 mr-1" /> Load from template
            </Button>
            <div>
              <Label>Customers</Label>
              <div className="border rounded-md p-2 space-y-1 max-h-60 overflow-y-auto mt-1">
                {customers.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted cursor-pointer">
                    <Checkbox
                      checked={dailyCustomers.includes(c.id)}
                      onCheckedChange={() => toggleCustomer(dailyCustomers, setDailyCustomers, c.id)}
                    />
                    <span className="text-sm">{c.customer_name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter><Button onClick={saveDaily}>Save Schedule</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
