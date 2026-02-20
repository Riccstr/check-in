import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Download, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";

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

  const formatTime12h = (time: string | null) => {
    if (!time) return "";
    const [h, m] = time.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${ampm}`;
  };

  const formatDuration = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const exportReportExcel = async () => {
    if (repFilter === "all") { toast.error("Please select a specific rep for the Excel report"); return; }
    if (!dateFrom) { toast.error("Please select a 'From' date for the Excel report"); return; }

    const selectedRep = reps.find((r) => r.id === repFilter);
    const repName = selectedRep?.rep_name || "Unknown";
    const reportDate = dateFrom;

    let q = supabase
      .from("visits")
      .select("*, reps(rep_name), customers(customer_name, area)")
      .eq("rep_id", repFilter)
      .order("arrival_time", { ascending: true });
    if (dateFrom) q = q.gte("visit_date", dateFrom);
    if (dateTo) q = q.lte("visit_date", dateTo);
    if (custFilter !== "all") q = q.eq("customer_id", custFilter);

    const { data } = await q;
    if (!data || data.length === 0) { toast.error("No data to export"); return; }

    const wb = XLSX.utils.book_new();
    const colCount = 6; // Customer Name, Area, Time In, Time Out, Duration, Notes

    // Build rows array
    const wsData: any[][] = [];

    // Row 1: Title
    wsData.push(["Daily Visit Report", "", "", "", "", ""]);
    // Row 2: Rep & Date
    const formattedDate = new Date(reportDate + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    wsData.push([`Rep: ${repName} | Date: ${formattedDate}`, "", "", "", "", ""]);
    // Row 3: Spacer
    wsData.push(["", "", "", "", "", ""]);
    // Row 4: Headers
    wsData.push(["Customer Name", "Area", "Time In", "Time Out", "Duration", "Notes"]);

    // Data rows
    let totalProductiveMins = 0;
    for (const v of data as any[]) {
      const isSkipped = v.status === "skipped";
      const dur = v.duration_minutes || 0;
      if (!isSkipped) totalProductiveMins += dur;
      wsData.push([
        v.customers?.customer_name || "",
        v.customers?.area || "",
        formatTime12h(v.arrival_time),
        formatTime12h(v.leaving_time),
        dur > 0 ? formatDuration(dur) : "",
        v.notes || "",
      ]);
    }

    // Totals row
    const totalsRowIdx = wsData.length;
    wsData.push(["Total Productive Time", "", "", "", formatDuration(totalProductiveMins), ""]);

    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Merge cells
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } }, // Title
      { s: { r: 1, c: 0 }, e: { r: 1, c: colCount - 1 } }, // Rep/Date
      { s: { r: totalsRowIdx, c: 0 }, e: { r: totalsRowIdx, c: 3 } }, // Totals label
    ];

    // Column widths
    ws["!cols"] = [
      { wch: 25 }, // Customer Name
      { wch: 18 }, // Area
      { wch: 14 }, // Time In
      { wch: 14 }, // Time Out
      { wch: 12 }, // Duration
      { wch: 35 }, // Notes
    ];

    // Apply styles (SheetJS community edition has limited style support, using cell properties)
    // Title row
    const titleCell = ws[XLSX.utils.encode_cell({ r: 0, c: 0 })];
    if (titleCell) { titleCell.s = { font: { bold: true, sz: 16 }, alignment: { horizontal: "center" } }; }
    // Sub-title
    const subCell = ws[XLSX.utils.encode_cell({ r: 1, c: 0 })];
    if (subCell) { subCell.s = { font: { italic: true, sz: 12 }, alignment: { horizontal: "center" } }; }

    // Header row (row index 3)
    const darkBlue = { rgb: "1B3A5C" };
    const white = { rgb: "FFFFFF" };
    for (let c = 0; c < colCount; c++) {
      const ref = XLSX.utils.encode_cell({ r: 3, c });
      if (ws[ref]) {
        ws[ref].s = {
          font: { bold: true, color: white, sz: 11 },
          fill: { fgColor: darkBlue },
          alignment: { horizontal: "center" },
        };
      }
    }

    // Data rows styling
    const lightGrey = { rgb: "F2F2F2" };
    const redBg = { rgb: "FFCCCC" };
    for (let r = 4; r < totalsRowIdx; r++) {
      const visitIdx = r - 4;
      const v = data[visitIdx] as any;
      const isSkipped = v?.status === "skipped";
      const isOddRow = (r - 4) % 2 === 1;
      for (let c = 0; c < colCount; c++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (ws[ref]) {
          ws[ref].s = {
            fill: isSkipped ? { fgColor: redBg } : isOddRow ? { fgColor: lightGrey } : undefined,
            alignment: { horizontal: c === 5 ? "left" : "center" },
          };
        }
      }
    }

    // Totals row styling
    for (let c = 0; c < colCount; c++) {
      const ref = XLSX.utils.encode_cell({ r: totalsRowIdx, c });
      if (ws[ref]) {
        ws[ref].s = {
          font: { bold: true, color: white, sz: 11 },
          fill: { fgColor: darkBlue },
          alignment: { horizontal: "center" },
        };
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, "Visit Report");
    XLSX.writeFile(wb, `visit_report_${repName.replace(/\s+/g, "_")}_${reportDate}.xlsx`);
    toast.success("Excel report exported");
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
          <Button onClick={exportReportExcel} className="bg-accent hover:bg-accent/90 text-accent-foreground"><FileSpreadsheet className="h-4 w-4 mr-2" /> Export Report (Excel)</Button>
        </div>
      </CardContent>
    </Card>
  );
}
