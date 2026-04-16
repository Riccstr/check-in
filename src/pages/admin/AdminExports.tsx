import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { toast } from "sonner";
import { format } from "date-fns";
import { Download, FileSpreadsheet } from "lucide-react";
import XLSX from "xlsx-js-style";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const LOGO_BASE64 = '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';

// ── Formatting helpers ───────────────────────────────────────────────────────

const formatAmount = (value: number | null | undefined): string => {
  if (value == null) return '';
  return value.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

function formatTime12h(time: string | null) {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${ampm}`;
}

function formatDuration(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ── Shared report data fetcher ───────────────────────────────────────────────

interface ReportData {
  data: any[];
  repName: string;
  totalProductiveMins: number;
  totalOrderQty: number;
  totalOrderAmount: number;
  skippedCount: number;
  travelTimeMins: number | null;
  scheduleItemCount: number;
  weekTemplateName: string;
  expectedProductiveMins: number;
  timePerCustomer: number;
  generatedAt: string;
  period: string;
  scheduleDayName: string;
  scheduleDayStr: string;
  areasStr: string;
  bannerLine2: string;
}

async function buildReportData(
  repId: string,
  repName: string,
  custFilter: string,
  dateFrom: string,
  dateTo: string,
): Promise<ReportData | null> {
  let q = supabase
    .from("visits")
    .select("*, reps(rep_name), customers(customer_name, area, account_number)")
    .eq("rep_id", repId)
    .neq("status", "in_progress")
    .order("visit_date", { ascending: true })
    .order("arrival_time", { ascending: true });
  if (dateFrom) q = q.gte("visit_date", dateFrom);
  if (dateTo) q = q.lte("visit_date", dateTo);
  if (custFilter !== "all") q = q.eq("customer_id", custFilter);

  const { data } = await q;
  if (!data || data.length === 0) return null;

  let totalProductiveMins = 0;
  let totalOrderQty = 0;
  let totalOrderAmount = 0;
  let skippedCount = 0;
  for (const v of data as any[]) {
    if (v.status === "skipped") { skippedCount++; continue; }
    totalProductiveMins += v.duration_minutes || 0;
    totalOrderQty += v.order_quantity || 0;
    totalOrderAmount += Number(v.order_amount) || 0;
  }

  let travelTimeMins: number | null = null;
  let scheduleItemCount = 0;
  let weekTemplateName = "";
  {
    const { data: dsData } = await (supabase as any)
      .from("daily_schedules")
      .select("weekly_template_id, schedule_date, schedule_items(id)")
      .eq("rep_id", repId)
      .eq("schedule_date", dateFrom)
      .maybeSingle() as { data: { weekly_template_id: string | null; schedule_date: string; schedule_items: any[] } | null };
    if (dsData) {
      scheduleItemCount = (dsData.schedule_items as any[])?.length ?? 0;
      if (dsData.weekly_template_id) {
        const { data: weekTmpl } = await supabase
          .from("weekly_templates")
          .select("name")
          .eq("id", dsData.weekly_template_id)
          .maybeSingle();
        if (weekTmpl) weekTemplateName = weekTmpl.name;

        const jsDay = new Date(dsData.schedule_date + "T12:00:00").getDay();
        const isoDow = jsDay === 0 ? 7 : jsDay;
        const { data: tmplData } = await (supabase as any)
          .from("schedule_templates")
          .select("travel_time_minutes")
          .eq("rep_id", repId)
          .eq("day_of_week", isoDow)
          .eq("weekly_template_id", dsData.weekly_template_id)
          .maybeSingle() as { data: { travel_time_minutes: number | null } | null };
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

  const scheduleDayName = format(new Date(dateFrom + "T12:00:00"), "EEEE");
  const scheduleDayStr = weekTemplateName ? `${scheduleDayName} · ${weekTemplateName}` : scheduleDayName;
  const distinctAreas = [...new Set((data as any[]).map((v: any) => v.customers?.area).filter(Boolean))] as string[];
  const areasStr = distinctAreas.join(" · ");
  const bannerLine2 = [areasStr, scheduleDayStr].filter(Boolean).join("   |   ");

  return {
    data,
    repName,
    totalProductiveMins,
    totalOrderQty,
    totalOrderAmount,
    skippedCount,
    travelTimeMins,
    scheduleItemCount,
    weekTemplateName,
    expectedProductiveMins,
    timePerCustomer,
    generatedAt,
    period,
    scheduleDayName,
    scheduleDayStr,
    areasStr,
    bannerLine2,
  };
}

// ── Style constants ──────────────────────────────────────────────────────────

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

const titleFont = { name: "Calibri", bold: true, color: { rgb: WHITE_CLR }, sz: 14 };
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

// ── Component ────────────────────────────────────────────────────────────────

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

  // ── Export Visits CSV ──────────────────────────────────────────────────────
  const exportVisits = async () => {
    let q = supabase
      .from("visits")
      .select("*, reps(rep_name), customers(customer_name, account_number, area)")
      .neq("status", "in_progress")
      .order("visit_date", { ascending: false })
      .order("arrival_time", { ascending: true });
    if (repFilter !== "all") q = q.eq("rep_id", repFilter);
    if (custFilter !== "all") q = q.eq("customer_id", custFilter);
    if (dateFrom) q = q.gte("visit_date", dateFrom);
    if (dateTo) q = q.lte("visit_date", dateTo);
    const { data } = await q;
    if (!data || data.length === 0) { toast.error("No data to export"); return; }

    const lines: string[] = [];

    // Metadata block
    const repLabel = repFilter === "all"
      ? "All Reps"
      : reps.find((r) => r.id === repFilter)?.rep_name || repFilter;
    const periodLabel = dateFrom
      ? (dateTo && dateTo !== dateFrom ? `${dateFrom} to ${dateTo}` : dateFrom)
      : "All";
    lines.push('"Check-In Tracker - Visit Export"');
    lines.push("");
    lines.push(`"Rep","${repLabel}"`);
    lines.push(`"Period","${periodLabel}"`);
    lines.push(`"Generated","${format(new Date(), "dd MMM yyyy HH:mm")}"`);
    lines.push("");

    // Headers
    lines.push(["#", "Account No.", "Customer", "Area", "Arrival", "Departure", "Duration (min)", "Order No.", "Qty", "Amount (R)", "Notes", "Status"]
      .map((h) => `"${h}"`).join(","));

    // Data rows
    let totalDuration = 0;
    let totalQty = 0;
    let totalAmount = 0;
    for (let idx = 0; idx < (data as any[]).length; idx++) {
      const v = data[idx] as any;
      const isSkipped = v.status === "skipped";
      const isOffRoute = v.status === "off_route";
      const dur = v.duration_minutes || 0;
      if (!isSkipped) {
        totalDuration += dur;
        totalQty += v.order_quantity || 0;
        totalAmount += Number(v.order_amount) || 0;
      }
      const statusLabel = isOffRoute ? "Off-Route Order" : isSkipped ? "Skipped" : "Visited";
      const row = [
        String(idx + 1),
        v.customers?.account_number || "",
        v.customers?.customer_name || "",
        v.customers?.area || "",
        isSkipped || isOffRoute ? "" : (v.arrival_time ? v.arrival_time.slice(0, 5) : ""),
        isSkipped || isOffRoute ? "" : (v.leaving_time ? v.leaving_time.slice(0, 5) : ""),
        isSkipped || isOffRoute ? "" : String(dur),
        v.order_number || "",
        v.order_quantity != null ? String(v.order_quantity) : "",
        v.order_amount != null ? Number(v.order_amount).toFixed(2) : "",
        (v.notes || "").replace(/"/g, '""'),
        statusLabel,
      ];
      lines.push(row.map((c) => `"${c}"`).join(","));
    }

    // Totals row
    lines.push([
      "", "", "", "", "", "",
      `"${totalDuration}"`,
      "", `"${totalQty}"`,
      `"${totalAmount.toFixed(2)}"`,
      "", "",
    ].join(","));

    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "visits_export.csv"; a.click();
    URL.revokeObjectURL(url);
    toast.success("Visits exported");
  };

  // ── Export Report (Excel) ──────────────────────────────────────────────────
  const exportReportExcel = async () => {
    if (repFilter === "all") { toast.error("Please select a specific rep for the Excel report"); return; }
    if (!dateFrom) { toast.error("Please select a 'From' date for the Excel report"); return; }

    const selectedRep = reps.find((r) => r.id === repFilter);
    const repName = selectedRep?.rep_name || "Unknown";

    const rd = await buildReportData(repFilter, repName, custFilter, dateFrom, dateTo);
    if (!rd) { toast.error("No data to export"); return; }

    const {
      data, totalProductiveMins, totalOrderQty, totalOrderAmount, skippedCount,
      travelTimeMins, scheduleItemCount, expectedProductiveMins, timePerCustomer,
      generatedAt, period,
    } = rd;

    // 12 columns: A=# B=Acc C=Cust D=Area E=Arr F=Dep G=Dur(min) H=OrdNo I=Qty J=Amt K=Notes L=Status
    const COL_COUNT = 12;

    const wb = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = {};
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 100, c: COL_COUNT - 1 } });

    ws["!cols"] = [
      { wch: 4 },   // #
      { wch: 11 },  // Account No.
      { wch: 20 },  // Customer
      { wch: 12 },  // Area
      { wch: 10 },  // Arrival
      { wch: 10 },  // Departure
      { wch: 9 },   // Duration
      { wch: 11 },  // Order No.
      { wch: 6 },   // Qty
      { wch: 12 },  // Amount (R)
      { wch: 22 },  // Notes
      { wch: 10 },  // Status
    ];

    ws["!rows"] = [];

    // ── ROW 0: Title banner ──────────────────────────────────────────────────
    ws["!rows"][0] = { hpt: 40 };
    const titleStyle = { font: titleFont, fill: navyFill, alignment: { ...cLeft, indent: 1 }, border: thinBorder };
    sc(ws, 0, 0, "Daily Visit Report", titleStyle);
    for (let c = 1; c < COL_COUNT; c++) ss(ws, 0, c, { fill: navyFill, border: thinBorder });
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } }];

    // ── ROW 1: Accent bar ────────────────────────────────────────────────────
    ws["!rows"][1] = { hpt: 6 };
    for (let c = 0; c < COL_COUNT; c++) ss(ws, 1, c, { fill: accentFill });
    ws["!merges"].push({ s: { r: 1, c: 0 }, e: { r: 1, c: COL_COUNT - 1 } });

    // ── ROWS 2–5: Three-block info summary (mirrors PDF layout) ─────────────
    // Block cols: Left=0-3, Centre=4-7, Right=8-11
    // Each block: label=first 2 cols merged, value=last 2 cols merged
    const leftLabels  = ["Name",          "Date",        "Period",  "Visits"];
    const leftValues  = [repName,          generatedAt,   period,    String(data.length)];
    const centreLabels = ["Travel Time",   "Expected Productive Time", "Total Customers on Route", "Time / Customer"];
    const centreValues = [
      travelTimeMins !== null ? formatDuration(travelTimeMins)         : "—",
      travelTimeMins !== null ? formatDuration(expectedProductiveMins)  : "—",
      String(scheduleItemCount),
      scheduleItemCount > 0   ? formatDuration(timePerCustomer)         : "—",
    ];
    const rightLabels = ["Productive Time", "Order Qty",       "Order Amount (R)", "Skipped"];
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

      // Left block: label cols 0-1, value cols 2-3
      sc(ws, row, 0, leftLabels[i], lblStyle);
      ss(ws, row, 1, lblStyle);
      ws["!merges"].push({ s: { r: row, c: 0 }, e: { r: row, c: 1 } });
      sc(ws, row, 2, leftValues[i], valStyle);
      ss(ws, row, 3, valStyle);
      ws["!merges"].push({ s: { r: row, c: 2 }, e: { r: row, c: 3 } });

      // Centre block: label cols 4-5, value cols 6-7
      sc(ws, row, 4, centreLabels[i], lblStyle);
      ss(ws, row, 5, lblStyle);
      ws["!merges"].push({ s: { r: row, c: 4 }, e: { r: row, c: 5 } });
      sc(ws, row, 6, centreValues[i], valStyle);
      ss(ws, row, 7, valStyle);
      ws["!merges"].push({ s: { r: row, c: 6 }, e: { r: row, c: 7 } });

      // Right block: label cols 8-9, value cols 10-11
      sc(ws, row, 8, rightLabels[i], lblStyle);
      ss(ws, row, 9, lblStyle);
      ws["!merges"].push({ s: { r: row, c: 8 }, e: { r: row, c: 9 } });
      sc(ws, row, 10, rightValues[i], valStyle);
      ss(ws, row, 11, valStyle);
      ws["!merges"].push({ s: { r: row, c: 10 }, e: { r: row, c: 11 } });
    }

    // ── ROW 6: Spacer ────────────────────────────────────────────────────────
    ws["!rows"][6] = { hpt: 10 };

    // ── ROW 7: Column headers ────────────────────────────────────────────────
    const headers = ["#", "Account #", "Customer", "Area", "Arrival", "Departure", "Duration", "Order No.", "Qty", "Amount (R)", "Notes", "Status"];
    ws["!rows"][7] = { hpt: 28 };
    const hdrStyle = { font: colHdrFont, fill: navyFill, alignment: cCenter, border: thinBorder };
    for (let c = 0; c < headers.length; c++) sc(ws, 7, c, headers[c], hdrStyle);

    // ── ROWS 8+: Data rows ───────────────────────────────────────────────────
    const colAligns = [cCenter, cLeft, cLeft, cLeft, cCenter, cCenter, cCenter, cLeft, cCenter, cRight, cWrap, cCenter];

    for (let idx = 0; idx < (data as any[]).length; idx++) {
      const v = data[idx] as any;
      const row = 8 + idx;
      ws["!rows"][row] = { hpt: 22 };

      const isSkipped = v.status === "skipped";
      const isOffRoute = v.status === "off_route";
      const isOdd = idx % 2 === 1;
      const bgFill = isSkipped ? redFill : isOdd ? altFill : whiteFill;
      const fnt = isSkipped ? skipFont : dataFont;

      const dur = v.duration_minutes || 0;
      const statusLabel = isOffRoute ? "Off-Route Order" : isSkipped ? "Skipped" : "Visited";

      const rowValues: any[] = [
        idx + 1,
        v.customers?.account_number || "",
        v.customers?.customer_name || "",
        v.customers?.area || "",
        isSkipped || isOffRoute ? "" : formatTime12h(v.arrival_time),
        isSkipped || isOffRoute ? "" : formatTime12h(v.leaving_time),
        isSkipped || isOffRoute ? "" : (dur > 0 ? formatDuration(dur) : ""),
        v.order_number || "",
        v.order_quantity != null ? v.order_quantity : "",
        v.order_amount != null ? v.order_amount : "",
        isSkipped ? `[SKIPPED] ${v.notes || ""}` : (v.notes || ""),
        statusLabel,
      ];

      for (let c = 0; c < rowValues.length; c++) {
        const cellStyle = { font: fnt, fill: bgFill, alignment: colAligns[c], border: thinBorder };
        const val = rowValues[c];
        sc(ws, row, c, val, cellStyle);
        if (c === 9 && typeof val === "number") {
          const ref = XLSX.utils.encode_cell({ r: row, c });
          ws[ref].z = "#,##0.00";
        }
      }
    }

    // ── Totals row ───────────────────────────────────────────────────────────
    const totalsRow = 8 + (data as any[]).length;
    ws["!rows"][totalsRow] = { hpt: 28 };

    const tStyle = { font: totalsFont, fill: navyFill, alignment: cCenter, border: thinBorder };
    const tRightStyle = { font: totalsFont, fill: navyFill, alignment: cRight, border: thinBorder };

    sc(ws, totalsRow, 0, "Totals", tStyle);
    for (let c = 1; c < 6; c++) ss(ws, totalsRow, c, tStyle);
    ws["!merges"].push({ s: { r: totalsRow, c: 0 }, e: { r: totalsRow, c: 5 } });

    sc(ws, totalsRow, 6, formatDuration(totalProductiveMins), tStyle);
    ss(ws, totalsRow, 7, tStyle);
    sc(ws, totalsRow, 8, totalOrderQty, tStyle);
    sc(ws, totalsRow, 9, totalOrderAmount, tRightStyle);
    const amtRef = XLSX.utils.encode_cell({ r: totalsRow, c: 9 });
    ws[amtRef].z = "#,##0.00";
    ss(ws, totalsRow, 10, tStyle);
    ss(ws, totalsRow, 11, tStyle);

    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalsRow, c: COL_COUNT - 1 } });

    XLSX.utils.book_append_sheet(wb, ws, "Visit Report");
    XLSX.writeFile(wb, `visit_report_${repName.replace(/\s+/g, "_")}_${dateFrom}.xlsx`);
    toast.success("Excel report exported");
  };

  // ── Export Report (PDF) ────────────────────────────────────────────────────
  const exportReportPDF = async () => {
    if (repFilter === "all") { toast.error("Please select a specific rep for the PDF report"); return; }
    if (!dateFrom) { toast.error("Please select a 'From' date for the PDF report"); return; }

    const selectedRep = reps.find((r) => r.id === repFilter);
    const repName = selectedRep?.rep_name || "Unknown";

    const rd = await buildReportData(repFilter, repName, custFilter, dateFrom, dateTo);
    if (!rd) { toast.error("No data to export"); return; }

    const {
      data, totalProductiveMins, totalOrderQty, totalOrderAmount, skippedCount,
      travelTimeMins, scheduleItemCount, expectedProductiveMins, timePerCustomer,
      generatedAt, period, bannerLine2,
    } = rd;

    // ── Document setup ───────────────────────────────────────────────────────
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const PW = 297; // page width
    const ML = 10;  // margin left
    const MR = 11;  // margin right
    const MT = 12;  // margin top
    const CW = PW - ML - MR; // content width = 276mm

    // ── Section 1: Title banner ──────────────────────────────────────────────
    const BANNER_H = 22;
    doc.setFillColor(27, 42, 74);          // #1B2A4A
    doc.rect(ML, MT, CW, BANNER_H, "F");

    // Logo — vertically centred in banner, left-aligned with small margin
    const LOGO_SIZE = 14; // mm
    const LOGO_Y = MT + (BANNER_H - LOGO_SIZE) / 2;
    doc.addImage(LOGO_BASE64, "JPEG", ML + 1, LOGO_Y, LOGO_SIZE, LOGO_SIZE);

    // Text starts to the right of the logo
    const TEXT_X = ML + 1 + LOGO_SIZE + 4;

    // Line 1 — rep name (bold, white)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(255, 255, 255);
    doc.text(repName, TEXT_X, MT + 10);

    // Line 2 — areas | schedule day (normal, muted white)
    if (bannerLine2) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(180, 205, 225);
      doc.text(bannerLine2, TEXT_X, MT + 17);
    }

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
      travelTimeMins !== null ? formatDuration(travelTimeMins)         : "—",
      travelTimeMins !== null ? formatDuration(expectedProductiveMins)  : "—",
      String(scheduleItemCount),
      scheduleItemCount > 0   ? formatDuration(timePerCustomer)         : "—",
    ];
    const rightLabels = ["Productive Time",   "Order Qty",       "Order Amount (R)",  "Skipped"];
    const rightValues = [
      formatDuration(totalProductiveMins),
      String(totalOrderQty),
      formatAmount(totalOrderAmount),
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
      const isOffRoute = v.status === "off_route";
      const dur = v.duration_minutes || 0;
      const row: any[] = [
        idx + 1,
        v.customers?.account_number || "",
        v.customers?.customer_name  || "",
        v.customers?.area           || "",
        isSkipped || isOffRoute ? "" : formatTime12h(v.arrival_time),
        isSkipped || isOffRoute ? "" : formatTime12h(v.leaving_time),
        isSkipped || isOffRoute ? "" : (dur > 0 ? formatDuration(dur) : ""),
        v.order_number || "",
        v.order_quantity != null ? String(v.order_quantity) : "",
        v.order_amount   != null ? formatAmount(Number(v.order_amount)) : "",
        isSkipped ? `[SKIPPED] ${v.notes || ""}` : (isOffRoute ? `[OFF-ROUTE] ${v.notes || ""}`.trimEnd() : (v.notes || "")),
      ];
      (row as any).__skipped = isSkipped;
      bodyRows.push(row);
    }

    autoTable(doc, {
      startY: tableStartY,
      head: [["#", "Account #", "Customer", "Area", "Arrival", "Departure", "Duration", "Order No.", "Qty", "Amount (R)", "Notes"]],
      body: bodyRows,
      foot: [["Tot", "", "", "", "", "", formatDuration(totalProductiveMins), "", String(totalOrderQty), formatAmount(totalOrderAmount), ""]],
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
        10: { halign: "left",   cellWidth: "auto" as any },
      },
      didParseCell: (hookData) => {
        if (hookData.section === "body" && hookData.row.raw && (hookData.row.raw as any).__skipped) {
          hookData.cell.styles.fillColor = [255, 224, 224];
          hookData.cell.styles.textColor = [153, 27, 27];
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
          <Button variant="outline" className="hover:bg-primary hover:text-primary-foreground" onClick={exportVisits}>
            <Download className="h-4 w-4 mr-2" /> Export Visits CSV
          </Button>
          <Button variant="outline" className="hover:bg-primary hover:text-primary-foreground" onClick={exportReportExcel}>
            <FileSpreadsheet className="h-4 w-4 mr-2" /> Export Report (Excel)
          </Button>
          <Button variant="outline" className="hover:bg-primary hover:text-primary-foreground" onClick={exportReportPDF}>
            <FileSpreadsheet className="h-4 w-4 mr-2" /> Export Report (PDF)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
