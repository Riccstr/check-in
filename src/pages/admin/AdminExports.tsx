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

    // ── Data fetch (unchanged) ───────────────────────────────────────────────
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

    // Sort: visit_date asc then arrival_time asc
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
        totalProductiveMins += v.duration_minutes    || 0;
        totalOrderQty       += v.order_quantity      || 0;
        totalOrderAmount    += Number(v.order_amount) || 0;
      }
    }

    const periodText = dateTo && dateTo !== dateFrom
      ? `${formatDateLabel(dateFrom)} \u2013 ${formatDateLabel(dateTo)}`
      : formatDateLabel(dateFrom);

    const formatRand = (n: number) =>
      `R ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

    // ── ARGB colour constants (FF prefix = fully opaque) ─────────────────────
    const NAVY      = "FF1B2A4A";
    const ACCENT    = "FF2E5090";
    const WHITE     = "FFFFFFFF";
    const LT_WARM   = "FFF5F2ED";
    const LABEL_BG  = "FFEDEAE4";
    const RED_BG    = "FFFFE0E0";
    const BDR       = "FFD5D0C8";
    const TEXT_DARK = "FF1A1A1A";
    const TEXT_RED  = "FF991B1B";

    // ── Re-usable fill helpers ───────────────────────────────────────────────
    const mkFill = (argb: string) =>
      ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });

    const navyFill   = mkFill(NAVY);
    const accentFill = mkFill(ACCENT);
    const whiteFill  = mkFill(WHITE);
    const labelFill  = mkFill(LABEL_BG);
    const ltWarmFill = mkFill(LT_WARM);
    const redFill    = mkFill(RED_BG);

    const thinBorder = {
      top:    { style: "thin" as const, color: { argb: BDR } },
      bottom: { style: "thin" as const, color: { argb: BDR } },
      left:   { style: "thin" as const, color: { argb: BDR } },
      right:  { style: "thin" as const, color: { argb: BDR } },
    };

    // ── Workbook ─────────────────────────────────────────────────────────────
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Check-In Tracker";
    const sheet = workbook.addWorksheet("Visit Report");

    // Column widths (A=1 … K=11)
    sheet.columns = [
      { width: 5  }, // A  #
      { width: 14 }, // B  Account #
      { width: 28 }, // C  Customer
      { width: 18 }, // D  Area
      { width: 13 }, // E  Arrival
      { width: 13 }, // F  Departure
      { width: 12 }, // G  Duration
      { width: 14 }, // H  Order No.
      { width: 8  }, // I  Qty
      { width: 14 }, // J  Amount (R)
      { width: 35 }, // K  Notes
    ];

    // ── Row 1: Title banner ──────────────────────────────────────────────────
    sheet.mergeCells(1, 1, 1, 11);
    const titleCell     = sheet.getCell(1, 1);
    titleCell.value     = "Daily Visit Report";
    titleCell.font      = { name: "Calibri", size: 18, bold: true, color: { argb: WHITE } };
    titleCell.fill      = navyFill;
    titleCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    sheet.getRow(1).height = 45;

    // ── Row 2: Accent bar ────────────────────────────────────────────────────
    sheet.mergeCells(2, 1, 2, 11);
    sheet.getCell(2, 1).fill = accentFill;
    sheet.getRow(2).height = 6;

    // ── Rows 3-6: Info block ─────────────────────────────────────────────────
    // Layout: A = left label | B:C merged = left value | D:F empty |
    //         G:H merged = right label | I:K merged = right value
    const infoLeft: [string, string][] = [
      ["Rep Name",     repName],
      ["Report Date",  formatDateLabel(dateFrom)],
      ["Period",       periodText],
      ["Total Visits", String(rows.length)],
    ];
    const infoRight: [string, string][] = [
      ["Total Productive Time", formatDuration(totalProductiveMins)],
      ["Total Order Qty",       String(totalOrderQty)],
      ["Total Order Amount",    formatRand(totalOrderAmount)],
      ["Skipped Visits",        String(skippedCount)],
    ];

    for (let i = 0; i < 4; i++) {
      const rn = 3 + i;
      sheet.getRow(rn).height = 22;

      // Apply base white fill + border to every cell first, so all positions
      // have a border even inside merged ranges and empty gap columns (D–F).
      for (let c = 1; c <= 11; c++) {
        const cell  = sheet.getCell(rn, c);
        cell.fill   = whiteFill;
        cell.border = thinBorder;
      }

      // Merge value and label spans (must happen after individual cell styling
      // so that per-cell border data is preserved at every column position).
      sheet.mergeCells(rn, 2, rn, 3);   // B:C  left value
      sheet.mergeCells(rn, 7, rn, 8);   // G:H  right label
      sheet.mergeCells(rn, 9, rn, 11);  // I:K  right value

      // Left label (A — single cell)
      const lLbl      = sheet.getCell(rn, 1);
      lLbl.value      = infoLeft[i][0];
      lLbl.font       = { name: "Calibri", size: 10, bold: true, color: { argb: NAVY } };
      lLbl.fill       = labelFill;
      lLbl.alignment  = { horizontal: "left", vertical: "middle", indent: 1 };

      // Left value (master = B = col 2)
      const lVal      = sheet.getCell(rn, 2);
      lVal.value      = infoLeft[i][1];
      lVal.font       = { name: "Calibri", size: 10, color: { argb: TEXT_DARK } };
      lVal.fill       = whiteFill;
      lVal.alignment  = { horizontal: "left", vertical: "middle", indent: 1 };

      // Right label (master = G = col 7)
      const rLbl      = sheet.getCell(rn, 7);
      rLbl.value      = infoRight[i][0];
      rLbl.font       = { name: "Calibri", size: 10, bold: true, color: { argb: NAVY } };
      rLbl.fill       = labelFill;
      rLbl.alignment  = { horizontal: "left", vertical: "middle", indent: 1 };

      // Right value (master = I = col 9)
      const rVal      = sheet.getCell(rn, 9);
      rVal.value      = infoRight[i][1];
      rVal.font       = { name: "Calibri", size: 10, color: { argb: TEXT_DARK } };
      rVal.fill       = whiteFill;
      rVal.alignment  = { horizontal: "left", vertical: "middle", indent: 1 };
    }

    // ── Row 7: Spacer ────────────────────────────────────────────────────────
    sheet.getRow(7).height = 10;

    // ── Row 8: Column headers ────────────────────────────────────────────────
    const HEADERS: string[] = [
      "#", "Account #", "Customer", "Area", "Arrival", "Departure",
      "Duration", "Order No.", "Qty", "Amount (R)", "Notes",
    ];
    const HDR_ALIGN: ExcelJS.Alignment["horizontal"][] = [
      "center", "left", "left", "left", "center", "center",
      "center", "left", "center", "right", "left",
    ];

    sheet.getRow(8).height = 28;
    HEADERS.forEach((label, idx) => {
      const cell      = sheet.getCell(8, idx + 1);
      cell.value      = label;
      cell.font       = { name: "Calibri", size: 10, bold: true, color: { argb: WHITE } };
      cell.fill       = navyFill;
      cell.alignment  = { horizontal: HDR_ALIGN[idx], vertical: "middle" };
      cell.border     = thinBorder;
    });

    // ── Data rows (row 9+) ────────────────────────────────────────────────────
    const DATA_ALIGN: ExcelJS.Alignment["horizontal"][] = [
      "center", "left", "left", "left", "center", "center",
      "center", "left", "center", "right", "left",
    ];

    rows.forEach((v: any, idx: number) => {
      const isSkipped = v.status === "skipped";
      const dur       = v.duration_minutes || 0;
      const rn        = 9 + idx;
      sheet.getRow(rn).height = 22;

      const rowFill   = isSkipped ? redFill : idx % 2 === 0 ? whiteFill : ltWarmFill;
      const fontColor = isSkipped ? TEXT_RED : TEXT_DARK;

      const values: any[] = [
        idx + 1,
        v.customers?.account_number || "",
        v.customers?.customer_name  || "",
        v.customers?.area           || "",
        formatTime12h(v.arrival_time),
        formatTime12h(v.leaving_time),
        dur > 0 ? formatDuration(dur) : "",
        v.order_number || "",
        v.order_quantity != null ? v.order_quantity       : "",
        v.order_amount   != null ? Number(v.order_amount) : "",
        (isSkipped ? "[SKIPPED] " : "") + (v.notes || ""),
      ];

      values.forEach((val, colIdx) => {
        const cell     = sheet.getCell(rn, colIdx + 1);
        cell.value     = val;
        cell.font      = { name: "Calibri", size: 10, color: { argb: fontColor } };
        cell.fill      = rowFill;
        cell.alignment = { horizontal: DATA_ALIGN[colIdx], vertical: "middle", wrapText: colIdx === 10 };
        cell.border    = thinBorder;
        // Amount column: native Excel number format
        if (colIdx === 9 && val !== "") cell.numFmt = "#,##0.00";
      });
    });

    // ── Totals row ────────────────────────────────────────────────────────────
    const totRn = 9 + rows.length;
    sheet.getRow(totRn).height = 28;

    // Style all 11 cells BEFORE merging to preserve border data at each position
    for (let c = 1; c <= 11; c++) {
      const cell     = sheet.getCell(totRn, c);
      cell.fill      = navyFill;
      cell.font      = { name: "Calibri", size: 10, bold: true, color: { argb: WHITE } };
      cell.border    = thinBorder;
      cell.alignment = { horizontal: "center", vertical: "middle" };
    }

    // Merge A–F, then label the master cell
    sheet.mergeCells(totRn, 1, totRn, 6);
    const totLabel      = sheet.getCell(totRn, 1);
    totLabel.value      = "Totals";
    totLabel.alignment  = { horizontal: "left", vertical: "middle", indent: 1 };

    // G: Duration total
    const totDur        = sheet.getCell(totRn, 7);
    totDur.value        = formatDuration(totalProductiveMins);
    totDur.alignment    = { horizontal: "center", vertical: "middle" };

    // I: Qty total
    const totQty        = sheet.getCell(totRn, 9);
    totQty.value        = totalOrderQty > 0 ? totalOrderQty : "";
    totQty.alignment    = { horizontal: "center", vertical: "middle" };
    if (totalOrderQty > 0) totQty.numFmt = "#,##0";

    // J: Amount total
    const totAmt        = sheet.getCell(totRn, 10);
    totAmt.value        = totalOrderAmount > 0 ? totalOrderAmount : "";
    totAmt.alignment    = { horizontal: "right", vertical: "middle" };
    if (totalOrderAmount > 0) totAmt.numFmt = "#,##0.00";

    // ── Generate & download ───────────────────────────────────────────────────
    const repSlug  = repName.replace(/\s+/g, "_");
    const filename = `visit_report_${repSlug}_${dateFrom}.xlsx`;
    const buffer   = await workbook.xlsx.writeBuffer();
    saveAs(
      new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      filename,
    );
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
