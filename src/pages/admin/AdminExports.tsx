import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Download, FileSpreadsheet } from "lucide-react";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

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
    let q = supabase.from("visits").select("*, reps(rep_name), customers(customer_name, account_number)").order("visit_date", { ascending: false });
    if (repFilter !== "all") q = q.eq("rep_id", repFilter);
    if (custFilter !== "all") q = q.eq("customer_id", custFilter);
    if (dateFrom) q = q.gte("visit_date", dateFrom);
    if (dateTo) q = q.lte("visit_date", dateTo);
    const { data } = await q;
    if (!data || data.length === 0) { toast.error("No data to export"); return; }
    const headers = ["visit_date", "rep_name", "customer_name", "account_number", "arrival_time", "leaving_time", "duration_minutes", "notes", "order_number", "order_quantity", "order_amount", "created_at"];
    const rows = data.map((v: any) => [v.visit_date, v.reps?.rep_name, v.customers?.customer_name, v.customers?.account_number || "", v.arrival_time, v.leaving_time, String(v.duration_minutes), v.notes || "", v.order_number || "", v.order_quantity != null ? String(v.order_quantity) : "", v.order_amount != null ? String(v.order_amount) : "", v.created_at]);
    downloadCSV("visits_export.csv", headers, rows);
    toast.success("Visits exported");
  };

  const exportAverages = async () => {
    let q = supabase.from("visits").select("rep_id, customer_id, duration_minutes, visit_date, order_quantity, order_amount, reps(rep_name), customers(customer_name)");
    if (repFilter !== "all") q = q.eq("rep_id", repFilter);
    if (custFilter !== "all") q = q.eq("customer_id", custFilter);
    if (dateFrom) q = q.gte("visit_date", dateFrom);
    if (dateTo) q = q.lte("visit_date", dateTo);
    const { data } = await q;
    if (!data || data.length === 0) { toast.error("No data to export"); return; }
    const map: Record<string, { rep: string; cust: string; total: number; count: number; totalQty: number; totalAmount: number }> = {};
    for (const v of data as any[]) {
      const key = `${v.rep_id}_${v.customer_id}`;
      if (!map[key]) map[key] = { rep: v.reps?.rep_name, cust: v.customers?.customer_name, total: 0, count: 0, totalQty: 0, totalAmount: 0 };
      map[key].total += v.duration_minutes;
      map[key].count += 1;
      map[key].totalQty += v.order_quantity || 0;
      map[key].totalAmount += v.order_amount || 0;
    }
    const headers = ["rep_name", "customer_name", "average_duration_minutes", "total_visits", "total_minutes", "total_order_quantity", "total_order_amount", "date_range_start", "date_range_end"];
    const rows = Object.values(map).map((m) => [m.rep, m.cust, String(Math.round(m.total / m.count)), String(m.count), String(m.total), String(m.totalQty), m.totalAmount.toFixed(2), dateFrom || "all", dateTo || "all"]);
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

  const formatDateLabel = (dateStr: string) =>
    new Date(dateStr + "T00:00:00").toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
    });

  const exportReportExcel = async () => {
    if (repFilter === "all") { toast.error("Please select a specific rep for the Excel report"); return; }
    if (!dateFrom) { toast.error("Please select a 'From' date for the Excel report"); return; }

    const selectedRep = reps.find((r) => r.id === repFilter);
    const repName = selectedRep?.rep_name || "Unknown";

    let q = supabase
      .from("visits")
      .select("*, reps(rep_name), customers(customer_name, area, account_number)")
      .eq("rep_id", repFilter)
      .order("arrival_time", { ascending: true });
    if (dateFrom) q = q.gte("visit_date", dateFrom);
    if (dateTo) q = q.lte("visit_date", dateTo);
    if (custFilter !== "all") q = q.eq("customer_id", custFilter);

    const { data } = await q;
    if (!data || data.length === 0) { toast.error("No data to export"); return; }

    // Sort client-side: visit_date asc, then arrival_time asc
    const rows = [...(data as any[])].sort((a, b) => {
      const dc = (a.visit_date || "").localeCompare(b.visit_date || "");
      return dc !== 0 ? dc : (a.arrival_time || "").localeCompare(b.arrival_time || "");
    });

    // Pre-calculate totals (productive = non-skipped only)
    let totalProductiveMins = 0;
    let totalOrderQty = 0;
    let totalOrderAmount = 0;
    let skippedCount = 0;
    for (const v of rows) {
      if (v.status === "skipped") {
        skippedCount++;
      } else {
        totalProductiveMins += v.duration_minutes || 0;
        totalOrderQty       += v.order_quantity   || 0;
        totalOrderAmount    += Number(v.order_amount) || 0;
      }
    }

    const periodText = dateTo && dateTo !== dateFrom
      ? `${formatDateLabel(dateFrom)} to ${formatDateLabel(dateTo)}`
      : formatDateLabel(dateFrom);

    const formatRand = (n: number) =>
      `R ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

    // ── ARGB color constants (FF prefix = fully opaque) ─────────────────────
    const NAVY     = "FF1B2A4A";
    const WHITE    = "FFFFFFFF";
    const LT_GREY  = "FFF0EDE8";
    const ALT_GREY = "FFF5F2ED";
    const RED_BG   = "FFFFE0E0";
    const BDR      = "FFD5D0C8";

    // ── Re-usable style fragments ────────────────────────────────────────────
    const navyFill   = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: NAVY    } };
    const whiteFill  = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: WHITE   } };
    const ltGreyFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: LT_GREY } };
    const altGreyFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: ALT_GREY } };
    const redFill    = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: RED_BG  } };

    const thinBorder = {
      top:    { style: "thin" as const, color: { argb: BDR } },
      bottom: { style: "thin" as const, color: { argb: BDR } },
      left:   { style: "thin" as const, color: { argb: BDR } },
      right:  { style: "thin" as const, color: { argb: BDR } },
    };

    // ── Workbook & worksheet ─────────────────────────────────────────────────
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Check-In Tracker";
    const sheet = workbook.addWorksheet("Visit Report");

    // Column widths  (A=1 … K=11)
    sheet.columns = [
      { width: 5  }, // A: #
      { width: 14 }, // B: Account #
      { width: 28 }, // C: Customer
      { width: 18 }, // D: Area
      { width: 13 }, // E: Arrival
      { width: 13 }, // F: Departure
      { width: 12 }, // G: Duration
      { width: 14 }, // H: Order No.
      { width: 8  }, // I: Qty
      { width: 14 }, // J: Amount (R)
      { width: 35 }, // K: Notes
    ];

    // ── Row 1: Main title ────────────────────────────────────────────────────
    sheet.mergeCells(1, 1, 1, 11);
    const titleCell = sheet.getCell(1, 1);
    titleCell.value     = "Daily Visit Report";
    titleCell.font      = { name: "Calibri", size: 18, bold: true, color: { argb: WHITE } };
    titleCell.fill      = navyFill;
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    sheet.getRow(1).height = 45;

    // ── Row 2: Spacer ────────────────────────────────────────────────────────
    sheet.getRow(2).height = 6;

    // ── Rows 3-6: Info block ─────────────────────────────────────────────────
    const infoLeft: [string, string][] = [
      ["Rep Name",    repName],
      ["Report Date", formatDateLabel(dateFrom)],
      ["Period",      periodText],
      ["Total Visits", String(rows.length)],
    ];
    const infoRight: [string, string][] = [
      ["Total Productive Time", formatDuration(totalProductiveMins)],
      ["Total Order Qty",       String(totalOrderQty)],
      ["Total Order Amount",    formatRand(totalOrderAmount)],
      ["Skipped Visits",        String(skippedCount)],
    ];

    for (let i = 0; i < 4; i++) {
      const rowNum = 3 + i;
      sheet.getRow(rowNum).height = 20;

      const lLabel = sheet.getCell(rowNum, 1);
      lLabel.value     = infoLeft[i][0];
      lLabel.font      = { name: "Calibri", size: 10, bold: true, color: { argb: NAVY } };
      lLabel.fill      = ltGreyFill;
      lLabel.alignment = { horizontal: "left", vertical: "middle" };

      const lVal = sheet.getCell(rowNum, 2);
      lVal.value     = infoLeft[i][1];
      lVal.font      = { name: "Calibri", size: 10 };
      lVal.fill      = whiteFill;
      lVal.alignment = { horizontal: "left", vertical: "middle" };

      const rLabel = sheet.getCell(rowNum, 7);
      rLabel.value     = infoRight[i][0];
      rLabel.font      = { name: "Calibri", size: 10, bold: true, color: { argb: NAVY } };
      rLabel.fill      = ltGreyFill;
      rLabel.alignment = { horizontal: "left", vertical: "middle" };

      const rVal = sheet.getCell(rowNum, 8);
      rVal.value     = infoRight[i][1];
      rVal.font      = { name: "Calibri", size: 10 };
      rVal.fill      = whiteFill;
      rVal.alignment = { horizontal: "left", vertical: "middle" };
    }

    // ── Row 7: Spacer ────────────────────────────────────────────────────────
    sheet.getRow(7).height = 6;

    // ── Row 8: Column headers ────────────────────────────────────────────────
    const HEADERS  = ["#", "Account #", "Customer", "Area", "Arrival", "Departure", "Duration", "Order No.", "Qty", "Amount (R)", "Notes"];
    const HDR_ALIGN: ExcelJS.Alignment["horizontal"][] = [
      "center", "left", "left", "left", "center", "center", "center", "left", "center", "right", "left",
    ];

    sheet.getRow(8).height = 28;
    HEADERS.forEach((label, idx) => {
      const cell = sheet.getCell(8, idx + 1);
      cell.value     = label;
      cell.font      = { name: "Calibri", size: 10, bold: true, color: { argb: WHITE } };
      cell.fill      = navyFill;
      cell.alignment = { horizontal: HDR_ALIGN[idx], vertical: "middle" };
      cell.border    = thinBorder;
    });

    // ── Data rows (row 9 onwards) ────────────────────────────────────────────
    const DATA_ALIGN: ExcelJS.Alignment["horizontal"][] = [
      "center", "left", "left", "left", "center", "center", "center", "left", "center", "right", "left",
    ];

    rows.forEach((v: any, idx: number) => {
      const isSkipped = v.status === "skipped";
      const dur       = v.duration_minutes || 0;
      const rowNum    = 9 + idx;

      sheet.getRow(rowNum).height = 22;

      const rowFill = isSkipped ? redFill : idx % 2 === 0 ? whiteFill : altGreyFill;

      const values: any[] = [
        idx + 1,
        v.customers?.account_number || "",
        v.customers?.customer_name  || "",
        v.customers?.area           || "",
        formatTime12h(v.arrival_time),
        formatTime12h(v.leaving_time),
        dur > 0 ? formatDuration(dur) : "",
        v.order_number || "",
        v.order_quantity  != null ? v.order_quantity  : "",
        v.order_amount    != null ? Number(v.order_amount).toFixed(2) : "",
        (isSkipped ? "[SKIPPED] " : "") + (v.notes || ""),
      ];

      values.forEach((val, colIdx) => {
        const cell = sheet.getCell(rowNum, colIdx + 1);
        cell.value     = val;
        cell.font      = { name: "Calibri", size: 10 };
        cell.fill      = rowFill;
        cell.alignment = { horizontal: DATA_ALIGN[colIdx], vertical: "middle" };
        cell.border    = thinBorder;
      });
    });

    // ── Totals row ───────────────────────────────────────────────────────────
    const totalsRowNum = 9 + rows.length;
    sheet.getRow(totalsRowNum).height = 28;

    // Style all 11 cells BEFORE merging so individual borders are preserved
    for (let c = 1; c <= 11; c++) {
      const cell = sheet.getCell(totalsRowNum, c);
      cell.fill      = navyFill;
      cell.font      = { name: "Calibri", size: 10, bold: true, color: { argb: WHITE } };
      cell.border    = thinBorder;
      cell.alignment = { horizontal: "center", vertical: "middle" };
    }

    // Merge A–F, then set "Totals" on the master cell
    sheet.mergeCells(totalsRowNum, 1, totalsRowNum, 6);
    const totalsLabelCell = sheet.getCell(totalsRowNum, 1);
    totalsLabelCell.value     = "Totals";
    totalsLabelCell.alignment = { horizontal: "left", vertical: "middle" };

    // G: Duration total
    const totDurCell = sheet.getCell(totalsRowNum, 7);
    totDurCell.value     = formatDuration(totalProductiveMins);
    totDurCell.alignment = { horizontal: "center", vertical: "middle" };

    // I: Qty total
    const totQtyCell = sheet.getCell(totalsRowNum, 9);
    totQtyCell.value     = totalOrderQty > 0 ? totalOrderQty : "";
    totQtyCell.alignment = { horizontal: "center", vertical: "middle" };

    // J: Amount total
    const totAmtCell = sheet.getCell(totalsRowNum, 10);
    totAmtCell.value     = totalOrderAmount > 0 ? totalOrderAmount.toFixed(2) : "";
    totAmtCell.alignment = { horizontal: "right", vertical: "middle" };

    // ── Save ─────────────────────────────────────────────────────────────────
    const repSlug  = repName.replace(/\s+/g, "_");
    const filename = `visit_report_${repSlug}_${dateFrom}.xlsx`;
    const buffer   = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
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
