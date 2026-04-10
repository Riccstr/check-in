import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { toast } from "sonner";
import { format } from "date-fns";
import { Download, FileSpreadsheet } from "lucide-react";
import XLSX from "xlsx-js-style";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

function downloadCSV(filename: string, headers: string[], rows: string[][]) {
  const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${(c ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Style constants ──────────────────────────────────────────────────
const NAVY = "1B2A4A";
const ACCENT = "2E5090";
const WHITE_CLR = "FFFFFF";
const LIGHT_WARM = "F5F2ED";
const LABEL_BG = "EDEAE4";
const RED_BG = "FFE0E0";
const RED_TEXT = "991B1B";
const BORDER_CLR = "D5D0C8";
const TEXT_CLR = "1A1A1A";

const thinBorder = {
  top: { style: "thin", color: { rgb: BORDER_CLR } },
  bottom: { style: "thin", color: { rgb: BORDER_CLR } },
  left: { style: "thin", color: { rgb: BORDER_CLR } },
  right: { style: "thin", color: { rgb: BORDER_CLR } },
};

const navyFill = { fgColor: { rgb: NAVY }, patternType: "solid" };
const accentFill = { fgColor: { rgb: ACCENT }, patternType: "solid" };
const labelFill = { fgColor: { rgb: LABEL_BG }, patternType: "solid" };
const whiteFill = { fgColor: { rgb: WHITE_CLR }, patternType: "solid" };
const altFill = { fgColor: { rgb: LIGHT_WARM }, patternType: "solid" };
const redFill = { fgColor: { rgb: RED_BG }, patternType: "solid" };

const titleFont = { name: "Calibri", bold: true, color: { rgb: WHITE_CLR }, sz: 18 };
const labelFont = { name: "Calibri", bold: true, color: { rgb: NAVY }, sz: 10 };
const valueFont = { name: "Calibri", color: { rgb: "333333" }, sz: 10 };
const colHdrFont = { name: "Calibri", bold: true, color: { rgb: WHITE_CLR }, sz: 10 };
const dataFont = { name: "Calibri", color: { rgb: TEXT_CLR }, sz: 10 };
const skipFont = { name: "Calibri", color: { rgb: RED_TEXT }, sz: 10 };
const totalsFont = { name: "Calibri", bold: true, color: { rgb: WHITE_CLR }, sz: 10 };

const cCenter = { horizontal: "center", vertical: "center" };
const cLeft = { horizontal: "left", vertical: "center" };
const cRight = { horizontal: "right", vertical: "center" };
const cWrap = { horizontal: "left", vertical: "center", wrapText: true };

// Helper: set a cell with value + style
function sc(ws: XLSX.WorkSheet, r: number, c: number, v: any, s: any) {
  const ref = XLSX.utils.encode_cell({ r, c });
  if (!ws[ref]) ws[ref] = {};
  ws[ref].v = v ?? "";
  ws[ref].t = typeof v === "number" ? "n" : "s";
  ws[ref].s = s;
}

// Helper: apply style to empty/merged cells
function ss(ws: XLSX.WorkSheet, r: number, c: number, s: any) {
  const ref = XLSX.utils.encode_cell({ r, c });
  if (!ws[ref]) ws[ref] = { v: "", t: "s" };
  ws[ref].s = s;
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
      supabase.from("customers").select("id, customer_name, area").order("customer_name"),
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

  const fmtDate = (d: string) => {
    return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  };

  const exportReportExcel = async () => {
    if (repFilter === "all") { toast.error("Please select a specific rep for the Excel report"); return; }
    if (!dateFrom) { toast.error("Please select a 'From' date for the Excel report"); return; }

    const selectedRep = reps.find((r) => r.id === repFilter);
    const repName = selectedRep?.rep_name || "Unknown";

    let q = supabase
      .from("visits")
      .select("*, reps(rep_name), customers(customer_name, area, account_number)")
      .eq("rep_id", repFilter)
      .order("visit_date", { ascending: true })
      .order("arrival_time", { ascending: true });
    if (dateFrom) q = q.gte("visit_date", dateFrom);
    if (dateTo) q = q.lte("visit_date", dateTo);
    if (custFilter !== "all") q = q.eq("customer_id", custFilter);

    const { data } = await q;
    if (!data || data.length === 0) { toast.error("No data to export"); return; }

    // Pre-calculate totals
    let totalProductiveMins = 0;
    let totalOrderQty = 0;
    let totalOrderAmount = 0;
    let skippedCount = 0;
    for (const v of data as any[]) {
      const isSkipped = v.status === "skipped";
      if (isSkipped) { skippedCount++; continue; }
      totalProductiveMins += v.duration_minutes || 0;
      totalOrderQty += v.order_quantity || 0;
      totalOrderAmount += v.order_amount || 0;
    }

    const COL_COUNT = 12; // A=# B=Acc C=Cust D=Area E=Arr F=Dep G=Dur H=OrdNo I=Qty J=Amt K=Photo L=Notes

    // Create workbook + sheet
    const wb = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = {};
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 100, c: COL_COUNT - 1 } });

    // Column widths (total ≈ 123 wch — fits A4 landscape at 85% scale)
    ws["!cols"] = [
      { wch: 4 },   // #
      { wch: 10 },  // Account #
      { wch: 20 },  // Customer
      { wch: 12 },  // Area
      { wch: 10 },  // Arrival
      { wch: 10 },  // Departure
      { wch: 8 },   // Duration
      { wch: 10 },  // Order No.
      { wch: 6 },   // Qty
      { wch: 11 },  // Amount
      { wch: 6 },   // Photo
      { wch: 22 },  // Notes
    ];

    // Row heights
    ws["!rows"] = [];

    // ════════════════════════════════════════════════════════════════
    // ROW 0 — Title banner
    // ════════════════════════════════════════════════════════════════
    ws["!rows"][0] = { hpt: 45 };
    const titleStyle = { font: titleFont, fill: navyFill, alignment: { ...cLeft, indent: 1 }, border: thinBorder };
    sc(ws, 0, 0, "Daily Visit Report", titleStyle);
    for (let c = 1; c < COL_COUNT; c++) ss(ws, 0, c, { fill: navyFill, border: thinBorder });
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } }];

    // ROW 1 — Accent bar
    ws["!rows"][1] = { hpt: 6 };
    for (let c = 0; c < COL_COUNT; c++) ss(ws, 1, c, { fill: accentFill });
    ws["!merges"].push({ s: { r: 1, c: 0 }, e: { r: 1, c: COL_COUNT - 1 } });

    // ════════════════════════════════════════════════════════════════
    // ROWS 2–5 — Info summary block
    // ════════════════════════════════════════════════════════════════
    const period = dateTo && dateTo !== dateFrom
      ? `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`
      : fmtDate(dateFrom);

   const leftLabels = ["Name", "Date", "Period", "Visits"];
    const leftValues = [repName, fmtDate(dateFrom), period, String(data.length)];
    const rightLabels = ["Total Productive Time", "Total Order Qty", "Total Order Amount", "Skipped Visits"];
    const rightValues = [
      formatDuration(totalProductiveMins),
      String(totalOrderQty),
      `R ${totalOrderAmount.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      String(skippedCount),
    ];

    const lblStyle = { font: labelFont, fill: labelFill, alignment: cLeft, border: thinBorder };
    const valStyle = { font: valueFont, fill: whiteFill, alignment: cLeft, border: thinBorder };

    for (let i = 0; i < 4; i++) {
      const row = 2 + i;
      ws["!rows"][row] = { hpt: 22 };

      // Left: label in col A, value merged B–C
      sc(ws, row, 0, leftLabels[i], lblStyle);
      sc(ws, row, 1, leftValues[i], valStyle);
      ss(ws, row, 2, valStyle);
      ws["!merges"].push({ s: { r: row, c: 1 }, e: { r: row, c: 2 } });

      // Empty spacer cols D–F
      for (let c = 3; c < 6; c++) ss(ws, row, c, {});

      // Right: label merged G–H, value merged I–K
      sc(ws, row, 6, rightLabels[i], lblStyle);
      ss(ws, row, 7, lblStyle);
      ws["!merges"].push({ s: { r: row, c: 6 }, e: { r: row, c: 7 } });

      sc(ws, row, 8, rightValues[i], valStyle);
      ss(ws, row, 9, valStyle);
      ss(ws, row, 10, valStyle);
      ws["!merges"].push({ s: { r: row, c: 8 }, e: { r: row, c: 10 } });
    }

    // ROW 6 — spacer
    ws["!rows"][6] = { hpt: 10 };

    // ════════════════════════════════════════════════════════════════
    // ROW 7 — Column headers
    // ════════════════════════════════════════════════════════════════
    const headers = ["#", "Account #", "Customer", "Area", "Arrival", "Departure", "Duration", "Order No.", "Qty", "Amount (R)", "Photo", "Notes"];
    ws["!rows"][7] = { hpt: 28 };
    const hdrStyle = { font: colHdrFont, fill: navyFill, alignment: cCenter, border: thinBorder };
    for (let c = 0; c < headers.length; c++) {
      sc(ws, 7, c, headers[c], hdrStyle);
    }

    // ════════════════════════════════════════════════════════════════
    // DATA ROWS (row 8+)
    // ════════════════════════════════════════════════════════════════
    // Column alignments: #=center, Acc=left, Cust=left, Area=left, Arr=center, Dep=center, Dur=center, OrdNo=left, Qty=center, Amt=right, Notes=wrapLeft
    const colAligns = [cCenter, cLeft, cLeft, cLeft, cCenter, cCenter, cCenter, cLeft, cCenter, cRight, cCenter, cWrap];

    for (let idx = 0; idx < (data as any[]).length; idx++) {
      const v = data[idx] as any;
      const row = 8 + idx;
      ws["!rows"][row] = { hpt: 22 };

      const isSkipped = v.status === "skipped";
      const isOdd = idx % 2 === 1;
      const bgFill = isSkipped ? redFill : isOdd ? altFill : whiteFill;
      const fnt = isSkipped ? skipFont : dataFont;

      const dur = v.duration_minutes || 0;
      const notesText = isSkipped ? `[SKIPPED] ${v.notes || ""}` : (v.notes || "");

      const rowValues: any[] = [
        idx + 1,
        v.customers?.account_number || "",
        v.customers?.customer_name || "",
        v.customers?.area || "",
        isSkipped ? "—" : formatTime12h(v.arrival_time),
        isSkipped ? "—" : formatTime12h(v.leaving_time),
        dur > 0 ? formatDuration(dur) : "",
        v.order_number || "",
        v.order_quantity != null ? v.order_quantity : "",
        v.order_amount != null ? v.order_amount : "",
        v.photo_url ? "✓" : "✗",
        notesText,
      ];

      for (let c = 0; c < rowValues.length; c++) {
        const cellStyle = { font: fnt, fill: bgFill, alignment: colAligns[c], border: thinBorder };
        const val = rowValues[c];
        sc(ws, row, c, val, cellStyle);
        // Number format for Amount column
        if (c === 9 && typeof val === "number") {
          const ref = XLSX.utils.encode_cell({ r: row, c });
          ws[ref].z = "#,##0.00";
        }
      }

      // Photo cell colour override (green ✓ / red ✗)
      const photoRef = XLSX.utils.encode_cell({ r: row, c: 10 });
      ws[photoRef].s = {
        ...ws[photoRef].s,
        font: { ...fnt, color: { rgb: v.photo_url ? "22C55E" : "EF4444" } },
      };
    }

    // ════════════════════════════════════════════════════════════════
    // TOTALS ROW
    // ════════════════════════════════════════════════════════════════
    const totalsRow = 8 + (data as any[]).length;
    ws["!rows"][totalsRow] = { hpt: 28 };

    const tStyle = { font: totalsFont, fill: navyFill, alignment: cCenter, border: thinBorder };
    const tRightStyle = { font: totalsFont, fill: navyFill, alignment: cRight, border: thinBorder };

    // Merge A–F for "Totals" label
    sc(ws, totalsRow, 0, "Totals", tStyle);
    for (let c = 1; c < 6; c++) ss(ws, totalsRow, c, tStyle);
    ws["!merges"].push({ s: { r: totalsRow, c: 0 }, e: { r: totalsRow, c: 5 } });

    // Duration total in G
    sc(ws, totalsRow, 6, formatDuration(totalProductiveMins), tStyle);
    // Order No. (empty)
    ss(ws, totalsRow, 7, tStyle);
    // Qty total in I
    sc(ws, totalsRow, 8, totalOrderQty, tStyle);
    // Amount total in J
    sc(ws, totalsRow, 9, totalOrderAmount, tRightStyle);
    const amtRef = XLSX.utils.encode_cell({ r: totalsRow, c: 9 });
    ws[amtRef].z = "#,##0.00";
    // Photo (empty)
    ss(ws, totalsRow, 10, tStyle);
    // Notes (empty)
    ss(ws, totalsRow, 11, tStyle);

    // Update sheet range to exact data bounds
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalsRow, c: COL_COUNT - 1 } });

    XLSX.utils.book_append_sheet(wb, ws, "Visit Report");
    XLSX.writeFile(wb, `visit_report_${repName.replace(/\s+/g, "_")}_${dateFrom}.xlsx`);
    toast.success("Excel report exported");
  };

  const exportReportPDF = async () => {
    if (repFilter === "all") { toast.error("Please select a specific rep for the PDF report"); return; }
    if (!dateFrom) { toast.error("Please select a 'From' date for the PDF report"); return; }

    const selectedRep = reps.find((r) => r.id === repFilter);
    const repName = selectedRep?.rep_name || "Unknown";

    let q = supabase
      .from("visits")
      .select("*, reps(rep_name), customers(customer_name, area, account_number)")
      .eq("rep_id", repFilter)
      .order("visit_date", { ascending: true })
      .order("arrival_time", { ascending: true });
    if (dateFrom) q = q.gte("visit_date", dateFrom);
    if (dateTo) q = q.lte("visit_date", dateTo);
    if (custFilter !== "all") q = q.eq("customer_id", custFilter);

    const { data } = await q;
    if (!data || data.length === 0) { toast.error("No data to export"); return; }

    // Pre-calculate totals (non-skipped only)
    let totalProductiveMins = 0;
    let totalOrderQty = 0;
    let totalOrderAmount = 0;
    let skippedCount = 0;
    for (const v of data as any[]) {
      if (v.status === "skipped") { skippedCount++; continue; }
      totalProductiveMins += v.duration_minutes || 0;
      totalOrderQty       += v.order_quantity   || 0;
      totalOrderAmount    += Number(v.order_amount) || 0;
    }

    // ── Fetch schedule template travel time + item count (keyed on dateFrom) ──
    let travelTimeMins: number | null = null;
    let scheduleItemCount = 0;
    {
      const { data: dsData } = await supabase
        .from("daily_schedules")
        .select("weekly_template_id, schedule_date, schedule_items(id)")
        .eq("rep_id", repFilter)
        .eq("schedule_date", dateFrom)
        .maybeSingle();
      if (dsData) {
        scheduleItemCount = (dsData.schedule_items as any[])?.length ?? 0;
        if (dsData.weekly_template_id) {
          const jsDay = new Date(dsData.schedule_date + "T12:00:00").getDay();
          const isoDow = jsDay === 0 ? 7 : jsDay;
          const { data: tmplData } = await supabase
            .from("schedule_templates")
            .select("travel_time_minutes")
            .eq("rep_id", repFilter)
            .eq("day_of_week", isoDow)
            .eq("weekly_template_id", dsData.weekly_template_id)
            .maybeSingle();
          if (tmplData) travelTimeMins = tmplData.travel_time_minutes;
        }
      }
    }
    const WORKING_DAY_MINS = 540;
    const travelTimeForCalc = travelTimeMins ?? 0;
    const expectedProductiveMins = WORKING_DAY_MINS - travelTimeForCalc;
    const timePerCustomer = scheduleItemCount > 0 ? Math.round(expectedProductiveMins / scheduleItemCount) : 0;

    const generatedAt = format(new Date(), "dd MMM yyyy HH:mm");
    const period = dateTo && dateTo !== dateFrom
      ? `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`
      : fmtDate(dateFrom);

    // ── Document setup ───────────────────────────────────────────────────────
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const PW = 297; // page width
    const ML = 10;  // margin left
    const MR = 11;  // margin right
    const MT = 12;  // margin top
    const CW = PW - ML - MR; // content width = 276mm

    // ── Section 1: Title banner ──────────────────────────────────────────────
    const BANNER_H = 16;
    doc.setFillColor(27, 42, 74);          // #1B2A4A
    doc.rect(ML, MT, CW, BANNER_H, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(255, 255, 255);
    doc.text("Daily Visit Report", ML + 6, MT + BANNER_H / 2 + 2.8); // vertically centered

    // Accent bar below banner
    const ACCENT_Y = MT + BANNER_H;
    doc.setFillColor(46, 80, 144);         // #2E5090
    doc.rect(ML, ACCENT_Y, CW, 2, "F");

    // ── Section 2: Info summary block ────────────────────────────────────────
    const INFO_Y    = ACCENT_Y + 2 + 4;   // 4mm gap below accent bar
    const ROW_H     = 7;
    const LBL_CLR: [number, number, number] = [237, 234, 228]; // #EDEAE4
    const VAL_CLR: [number, number, number] = [255, 255, 255]; // #FFFFFF
    const BDR_CLR: [number, number, number] = [213, 208, 200]; // #D5D0C8
    const NAVY_TXT: [number, number, number]  = [27, 42, 74];
    const DARK_TXT: [number, number, number]  = [51, 51, 51];

    // Column x-positions and widths
    // Three equal blocks: each 92mm (52 label + 40 value), fills 276mm content width
    const LX  = ML,           LLW = 52; // left label
    const LVX = ML + LLW,     LVW = 40; // left value
    const CX  = ML + 92,      CLW = 52; // centre label
    const CVX = CX + CLW,     CVW = 40; // centre value
    const RX  = ML + 184,     RLW = 52; // right label
    const RVX = RX + RLW,     RVW = 40; // right value

    const leftLabels  = ["Name",  "Date",        "Period",  "Visits"];
    const leftValues  = [repName, generatedAt,   period,    String(data.length)];
    const centreLabels = ["Travel Time", "Expected Productive Time", "Total Customers on Route", "Time / Customer"];
    const centreValues = [
      travelTimeMins !== null ? formatDuration(travelTimeMins)        : "—",
      travelTimeMins !== null ? formatDuration(expectedProductiveMins) : "—",
      String(scheduleItemCount),
      scheduleItemCount > 0   ? formatDuration(timePerCustomer)        : "—",
    ];
    const rightLabels = ["Productive Time",   "Order Qty",       "Order Amount (R)",                                                    "Skipped"];
    const rightValues = [
      formatDuration(totalProductiveMins),
      String(totalOrderQty),
      totalOrderAmount.toFixed(2),
      String(skippedCount),
    ];

    for (let i = 0; i < 4; i++) {
      const y = INFO_Y + i * ROW_H;

      // Left label cell
      doc.setFillColor(...LBL_CLR);
      doc.rect(LX, y, LLW, ROW_H, "F");
      doc.setDrawColor(...BDR_CLR);
      doc.rect(LX, y, LLW, ROW_H, "S");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...NAVY_TXT);
      doc.text(leftLabels[i], LX + 2, y + ROW_H / 2 + 1.5);

      // Left value cell
      doc.setFillColor(...VAL_CLR);
      doc.rect(LVX, y, LVW, ROW_H, "F");
      doc.rect(LVX, y, LVW, ROW_H, "S");
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...DARK_TXT);
      doc.text(leftValues[i], LVX + 2, y + ROW_H / 2 + 1.5);

      // Centre label cell
      doc.setFillColor(...LBL_CLR);
      doc.rect(CX, y, CLW, ROW_H, "F");
      doc.setDrawColor(...BDR_CLR);
      doc.rect(CX, y, CLW, ROW_H, "S");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...NAVY_TXT);
      doc.text(centreLabels[i], CX + 2, y + ROW_H / 2 + 1.5);

      // Centre value cell
      doc.setFillColor(...VAL_CLR);
      doc.rect(CVX, y, CVW, ROW_H, "F");
      doc.rect(CVX, y, CVW, ROW_H, "S");
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...DARK_TXT);
      doc.text(centreValues[i], CVX + 2, y + ROW_H / 2 + 1.5);

      // Right label cell
      doc.setFillColor(...LBL_CLR);
      doc.rect(RX, y, RLW, ROW_H, "F");
      doc.rect(RX, y, RLW, ROW_H, "S");
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...NAVY_TXT);
      doc.text(rightLabels[i], RX + 2, y + ROW_H / 2 + 1.5);

      // Right value cell
      doc.setFillColor(...VAL_CLR);
      doc.rect(RVX, y, RVW, ROW_H, "F");
      doc.rect(RVX, y, RVW, ROW_H, "S");
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...DARK_TXT);
      doc.text(rightValues[i], RVX + 2, y + ROW_H / 2 + 1.5);
    }

    // ── Section 3: Data table ─────────────────────────────────────────────────
    const tableStartY = INFO_Y + 4 * ROW_H + 6;

    const bodyRows: any[][] = [];
    for (let idx = 0; idx < (data as any[]).length; idx++) {
      const v = data[idx] as any;
      const isSkipped = v.status === "skipped";
      const dur = v.duration_minutes || 0;
      const row: any[] = [
        idx + 1,
        v.customers?.account_number || "",
        v.customers?.customer_name  || "",
        v.customers?.area           || "",
        isSkipped ? "—" : formatTime12h(v.arrival_time),
        isSkipped ? "—" : formatTime12h(v.leaving_time),
        dur > 0 ? formatDuration(dur) : "",
        v.order_number || "",
        v.order_quantity != null ? String(v.order_quantity) : "",
        v.order_amount   != null ? Number(v.order_amount).toFixed(2) : "",
        v.photo_url ? "\u2714" : "\u2718",
        isSkipped ? `[SKIPPED] ${v.notes || ""}` : (v.notes || ""),
      ];
      (row as any).__skipped = isSkipped;
      bodyRows.push(row);
    }

    autoTable(doc, {
      startY: tableStartY,
      head: [["#", "Account #", "Customer", "Area", "Arrival", "Departure", "Duration", "Order No.", "Qty", "Amount (R)", "Photo", "Notes"]],
      body: bodyRows,
      foot: [["Tot", "", "", "", "", "", formatDuration(totalProductiveMins), "", String(totalOrderQty), totalOrderAmount.toFixed(2), "", ""]],
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 8,
        cellPadding: 2,
        lineColor: [213, 208, 200],
        lineWidth: 0.3,
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: [27, 42, 74],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        halign: "center",
        fontSize: 8,
      },
      footStyles: {
        fillColor: [27, 42, 74],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        halign: "center",
        fontSize: 8,
      },
      alternateRowStyles: {
        fillColor: [245, 242, 237],
      },
      columnStyles: {
        0:  { halign: "center", cellWidth: 8 },
        1:  { halign: "left",   cellWidth: 18 },
        2:  { halign: "left",   cellWidth: 35 },
        3:  { halign: "left",   cellWidth: 22 },
        4:  { halign: "center", cellWidth: 20 },
        5:  { halign: "center", cellWidth: 20 },
        6:  { halign: "center", cellWidth: 16 },
        7:  { halign: "left",   cellWidth: 20 },
        8:  { halign: "center", cellWidth: 12 },
        9:  { halign: "right",  cellWidth: 22 },
        10: { halign: "center", cellWidth: 12 },
        11: { halign: "left",   cellWidth: "auto" as any },
      },
      didParseCell: (hookData) => {
        if (hookData.section === "body") {
          if (hookData.column.index === 10) {
            if (hookData.cell.raw === "\u2714") {
              hookData.cell.styles.textColor = [34, 197, 94];
            } else if (hookData.cell.raw === "\u2718") {
              hookData.cell.styles.textColor = [239, 68, 68];
            }
            if (hookData.row.raw && (hookData.row.raw as any).__skipped) {
              hookData.cell.styles.fillColor = [255, 224, 224];
            }
          } else if (hookData.row.raw && (hookData.row.raw as any).__skipped) {
            hookData.cell.styles.fillColor = [255, 224, 224];
            hookData.cell.styles.textColor = [153, 27, 27];
          }
        }
      },
      margin: { left: ML, right: MR },
    });

    doc.save(`visit_report_${repName.replace(/\s+/g, "_")}_${dateFrom}.pdf`);
    toast.success("PDF report exported");
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Download className="h-5 w-5 text-accent" /> Export Data</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1"><Label className="text-xs">Rep</Label>
            <SearchableSelect
              value={repFilter}
              onValueChange={setRepFilter}
              options={reps.map((r) => ({ value: r.id, label: r.rep_name }))}
              placeholder="All Reps"
              searchPlaceholder="Search reps..."
              includeAll
              allLabel="All Reps"
              className="w-40"
            /></div>
          <div className="flex flex-col gap-1"><Label className="text-xs">Customer</Label>
            <SearchableSelect
              value={custFilter}
              onValueChange={setCustFilter}
              options={customers.map((c) => ({ value: c.id, label: c.customer_name + (c.area ? ` (${c.area})` : "") }))}
              placeholder="All Customers"
              searchPlaceholder="Search customers..."
              includeAll
              allLabel="All Customers"
              className="w-44"
            /></div>
          <div className="flex flex-col gap-1"><Label className="text-xs">From</Label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" /></div>
          <div className="flex flex-col gap-1"><Label className="text-xs">To</Label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" /></div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button onClick={exportVisits}><Download className="h-4 w-4 mr-2" /> Export Visits CSV</Button>
          <Button variant="outline" onClick={exportAverages}><Download className="h-4 w-4 mr-2" /> Export Averages CSV</Button>
          <Button onClick={exportReportExcel} className="bg-accent hover:bg-accent/90 text-accent-foreground"><FileSpreadsheet className="h-4 w-4 mr-2" /> Export Report (Excel)</Button>
          <Button onClick={exportReportPDF} variant="secondary"><FileSpreadsheet className="h-4 w-4 mr-2" /> Export Report (PDF)</Button>
        </div>
      </CardContent>
    </Card>
  );
}
