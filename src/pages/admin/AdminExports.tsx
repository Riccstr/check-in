import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Download } from "lucide-react";

function downloadCSV(filename: string, headers: string[], rows: string[][]) {
  const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${(c ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function AdminExports() {
  const [reps, setReps] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [repFilter, setRepFilter] = useState("all");
  const [custFilter, setCustFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    Promise.all([
      supabase.from("reps").select("id, rep_name").order("rep_name"),
      supabase.from("customers").select("id, customer_name").order("customer_name"),
    ]).then(([r, c]) => { setReps(r.data || []); setCustomers(c.data || []); });
  }, []);

  const exportVisits = async () => {
    let q = supabase.from("visits").select("*, reps(rep_name), customers(customer_name)").order("visit_date", { ascending: false });
    if (repFilter !== "all") q = q.eq("rep_id", repFilter);
    if (custFilter !== "all") q = q.eq("customer_id", custFilter);
    if (dateFrom) q = q.gte("visit_date", dateFrom);
    if (dateTo) q = q.lte("visit_date", dateTo);
    const { data } = await q;
    if (!data || data.length === 0) { toast.error("No data to export"); return; }
    const headers = ["visit_date", "rep_name", "customer_name", "arrival_time", "leaving_time", "duration_minutes", "notes", "created_at"];
    const rows = data.map((v: any) => [v.visit_date, v.reps?.rep_name, v.customers?.customer_name, v.arrival_time, v.leaving_time, String(v.duration_minutes), v.notes || "", v.created_at]);
    downloadCSV("visits_export.csv", headers, rows);
    toast.success("Visits exported");
  };

  const exportAverages = async () => {
    let q = supabase.from("visits").select("rep_id, customer_id, duration_minutes, visit_date, reps(rep_name), customers(customer_name)");
    if (repFilter !== "all") q = q.eq("rep_id", repFilter);
    if (custFilter !== "all") q = q.eq("customer_id", custFilter);
    if (dateFrom) q = q.gte("visit_date", dateFrom);
    if (dateTo) q = q.lte("visit_date", dateTo);
    const { data } = await q;
    if (!data || data.length === 0) { toast.error("No data to export"); return; }
    const map: Record<string, { rep: string; cust: string; total: number; count: number }> = {};
    for (const v of data as any[]) {
      const key = `${v.rep_id}_${v.customer_id}`;
      if (!map[key]) map[key] = { rep: v.reps?.rep_name, cust: v.customers?.customer_name, total: 0, count: 0 };
      map[key].total += v.duration_minutes;
      map[key].count += 1;
    }
    const headers = ["rep_name", "customer_name", "average_duration_minutes", "total_visits", "total_minutes", "date_range_start", "date_range_end"];
    const rows = Object.values(map).map((m) => [m.rep, m.cust, String(Math.round(m.total / m.count)), String(m.count), String(m.total), dateFrom || "all", dateTo || "all"]);
    downloadCSV("averages_export.csv", headers, rows);
    toast.success("Averages exported");
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Download className="h-5 w-5 text-accent" /> Export Data</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap gap-3">
          <div className="space-y-1"><Label className="text-xs">Rep</Label>
            <Select value={repFilter} onValueChange={setRepFilter}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Reps</SelectItem>{reps.map((r) => <SelectItem key={r.id} value={r.id}>{r.rep_name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">Customer</Label>
            <Select value={custFilter} onValueChange={setCustFilter}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Customers</SelectItem>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.customer_name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" /></div>
          <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" /></div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button onClick={exportVisits}><Download className="h-4 w-4 mr-2" /> Export Visits CSV</Button>
          <Button variant="outline" onClick={exportAverages}><Download className="h-4 w-4 mr-2" /> Export Averages CSV</Button>
        </div>
      </CardContent>
    </Card>
  );
}
