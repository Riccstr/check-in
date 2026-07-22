import { useState, useEffect, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { toast } from "sonner";
import { format } from "date-fns";
import { FileSpreadsheet } from "lucide-react";
import { fmtDuration, fmtTime12h, fmtCurrency } from "@/lib/timeUtils";
import { buildReportData, type ReportData } from "@/lib/reportData";
import { A, PageHeader } from "@/lib/adminUi";

const LOGO_BASE64 = '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';

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

// ── Presentational sub-components (redesign) ─────────────────────────────────

function ExportAction({ icon, label, desc, meta, ready, onClick }: {
  icon: ReactNode;
  label: string;
  desc: string;
  meta: string;
  ready?: boolean;
  onClick: () => void;
}) {
  const isReady = ready ?? true;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!isReady}
      style={{
        display: "flex",
        gap: 11,
        padding: "11px 12px",
        border: `1px solid ${isReady ? A.green : A.border}`,
        borderRadius: 8,
        background: isReady ? A.greenSoft : A.panelTint,
        cursor: isReady ? "pointer" : "not-allowed",
        textAlign: "left",
        fontFamily: A.sans,
        width: "100%",
      }}
    >
      <div style={{ width: 30, height: 30, borderRadius: 6, background: isReady ? A.green : A.borderSoft, color: isReady ? A.cream : A.inkSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: isReady ? A.greenInk : A.inkSoft }}>{label}</div>
          <div style={{ fontSize: 10, color: isReady ? A.green : A.inkMute, fontWeight: 500 }}>{meta}</div>
        </div>
        <div style={{ fontSize: 11.5, color: isReady ? A.greenInk : A.inkMute, marginTop: 3, lineHeight: 1.4 }}>{desc}</div>
      </div>
    </button>
  );
}

function SummaryBlock({ rows, last }: { rows: [string, string][]; last?: boolean }) {
  return (
    <div style={{ borderRight: last ? "none" : `1px solid ${A.border}` }}>
      {rows.map(([k, v], i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "0.9fr 1.1fr", borderBottom: i < rows.length - 1 ? `1px solid ${A.border}` : "none" }}>
          <div style={{ padding: "7px 12px", background: "#EDEAE4", fontSize: 11, fontWeight: 600, color: "#1B2A4A", fontFamily: A.sans }}>{k}</div>
          <div style={{ padding: "7px 12px", background: "#FFFFFF", fontSize: 11.5, color: "#333", fontFamily: A.sans }}>{v}</div>
        </div>
      ))}
    </div>
  );
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
    const toastId = toast.loading("Exporting visits…");
    let q = (supabase as any)
      .from("visits")
      .select("*, reps(rep_name), customers(customer_name, account_number, area)")
      .not("status", "in", "(in_progress,superseded)")
      .eq("is_deleted", false)
      .order("visit_date", { ascending: false })
      .order("arrival_time", { ascending: true });
    if (repFilter !== "all") q = q.eq("rep_id", repFilter);
    if (custFilter !== "all") q = q.eq("customer_id", custFilter);
    if (dateFrom) q = q.gte("visit_date", dateFrom);
    if (dateTo) q = q.lte("visit_date", dateTo);
    const { data } = await q;
    if (!data || data.length === 0) { toast.dismiss(toastId); toast.error("No data to export"); return; }

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
    toast.dismiss(toastId); toast.success("Visits exported");
  };

  // ── Export Report (Excel) ──────────────────────────────────────────────────
  const exportReportExcel = async () => {
    const toastId = toast.loading("Building Excel report…");
    if (repFilter === "all") { toast.dismiss(toastId); toast.error("Please select a specific rep for the Excel report"); return; }
    if (!dateFrom) { toast.dismiss(toastId); toast.error("Please select a 'From' date for the Excel report"); return; }

    const XLSX = (await import("xlsx-js-style")).default;

    const selectedRep = reps.find((r) => r.id === repFilter);
    const repName = selectedRep?.rep_name || "Unknown";

    const rd = await buildReportData(repFilter, repName, custFilter, dateFrom, dateTo);
    if (!rd) { toast.dismiss(toastId); toast.error("No data to export"); return; }

    const {
      data, totalProductiveMins, totalOrderQty, totalOrderAmount, skippedCount,
      travelTimeMins, scheduleItemCount, expectedProductiveMins, timePerCustomer,
      generatedAt, period, unscheduledVisitIds,
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
      travelTimeMins !== null ? fmtDuration(travelTimeMins)         : "—",
      travelTimeMins !== null ? fmtDuration(expectedProductiveMins)  : "—",
      String(scheduleItemCount),
      scheduleItemCount > 0   ? fmtDuration(timePerCustomer)         : "—",
    ];
    const rightLabels = ["Productive Time", "Order Qty",       "Order Amount (R)", "Skipped"];
    const rightValues = [
      fmtDuration(totalProductiveMins),
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
        isSkipped || isOffRoute ? "" : fmtTime12h(v.arrival_time),
        isSkipped || isOffRoute ? "" : fmtTime12h(v.leaving_time),
        isSkipped || isOffRoute ? "" : (dur > 0 ? fmtDuration(dur) : ""),
        v.order_number || "",
        v.order_quantity != null ? v.order_quantity : "",
        v.order_amount != null ? v.order_amount : "",
        isSkipped ? `[SKIPPED] ${v.notes || ""}` : (isOffRoute ? `[OFF-ROUTE] ${v.notes || ""}`.trimEnd() : (unscheduledVisitIds.has(v.id) ? `[UNSCHEDULED] ${v.notes || ""}`.trimEnd() : (v.notes || ""))),
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

    sc(ws, totalsRow, 6, fmtDuration(totalProductiveMins), tStyle);
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
    toast.dismiss(toastId); toast.success("Excel report exported");
  };

  // ── Export Report (PDF) ────────────────────────────────────────────────────
  const exportReportPDF = async () => {
    const toastId = toast.loading("Building PDF report…");
    if (repFilter === "all") { toast.dismiss(toastId); toast.error("Please select a specific rep for the PDF report"); return; }
    if (!dateFrom) { toast.dismiss(toastId); toast.error("Please select a 'From' date for the PDF report"); return; }

    const jsPDF = (await import("jspdf")).default;
    const { default: autoTable } = await import("jspdf-autotable");

    const selectedRep = reps.find((r) => r.id === repFilter);
    const repName = selectedRep?.rep_name || "Unknown";

    const rd = await buildReportData(repFilter, repName, custFilter, dateFrom, dateTo);
    if (!rd) { toast.dismiss(toastId); toast.error("No data to export"); return; }

    const {
      data, totalProductiveMins, totalOrderQty, totalOrderAmount, skippedCount,
      travelTimeMins, scheduleItemCount, expectedProductiveMins, timePerCustomer,
      generatedAt, period, bannerLine2, unscheduledVisitIds,
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
      travelTimeMins !== null ? fmtDuration(travelTimeMins)         : "—",
      travelTimeMins !== null ? fmtDuration(expectedProductiveMins)  : "—",
      String(scheduleItemCount),
      scheduleItemCount > 0   ? fmtDuration(timePerCustomer)         : "—",
    ];
    const rightLabels = ["Productive Time",   "Order Qty",       "Order Amount (R)",  "Skipped"];
    const rightValues = [
      fmtDuration(totalProductiveMins),
      String(totalOrderQty),
      fmtCurrency(totalOrderAmount),
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
        isSkipped || isOffRoute ? "" : fmtTime12h(v.arrival_time),
        isSkipped || isOffRoute ? "" : fmtTime12h(v.leaving_time),
        isSkipped || isOffRoute ? "" : (dur > 0 ? fmtDuration(dur) : ""),
        v.order_number || "",
        v.order_quantity != null ? String(v.order_quantity) : "",
        v.order_amount   != null ? fmtCurrency(Number(v.order_amount)) : "",
        isSkipped ? `[SKIPPED] ${v.notes || ""}` : (isOffRoute ? `[OFF-ROUTE] ${v.notes || ""}`.trimEnd() : (unscheduledVisitIds.has(v.id) ? `[UNSCHEDULED] ${v.notes || ""}`.trimEnd() : (v.notes || ""))),
      ];
      (row as any).__skipped = isSkipped;
      bodyRows.push(row);
    }

    autoTable(doc, {
      startY: tableStartY,
      head: [["#", "Account #", "Customer", "Area", "Arrival", "Departure", "Duration", "Order No.", "Qty", "Amount (R)", "Notes"]],
      body: bodyRows,
      foot: [["Tot", "", "", "", "", "", fmtDuration(totalProductiveMins), "", String(totalOrderQty), fmtCurrency(totalOrderAmount), ""]],
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
    toast.dismiss(toastId); toast.success("PDF report exported");
  };

  // Display labels for the preview pane — purely derived from current filter state.
  const repLabel = repFilter === "all" ? "All reps" : reps.find((r) => r.id === repFilter)?.rep_name || "—";
  const custLabel = custFilter === "all" ? "All customers" : customers.find((c) => c.id === custFilter)?.customer_name || "—";
  const periodLabel = dateFrom
    ? (dateTo && dateTo !== dateFrom ? `${dateFrom} → ${dateTo}` : dateFrom)
    : "All time";

  const canExportSingleRep = repFilter !== "all" && !!dateFrom;

  // Quick range presets
  const setRange = (fromOffsetDays: number | null) => {
    if (fromOffsetDays === null) { setDateFrom(""); setDateTo(""); return; }
    const today = new Date();
    const from = new Date(today);
    from.setDate(today.getDate() - fromOffsetDays);
    setDateFrom(from.toISOString().slice(0, 10));
    setDateTo(today.toISOString().slice(0, 10));
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: A.bg, minHeight: 0, fontFamily: A.sans, color: A.ink }}>
      <PageHeader
        title="Exports"
        subtitle="Generate reports for finance, ops review and rep performance"
      />

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "420px 1fr", minHeight: 0 }}>

        {/* ───────────── LEFT: configurator ───────────── */}
        <div style={{ borderRight: `1px solid ${A.border}`, background: A.panel, overflow: "auto", padding: "20px 22px" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: A.ink, marginBottom: 3 }}>Build a report</div>
          <div style={{ fontSize: 11.5, color: A.inkMute, marginBottom: 18 }}>Filter the data, then pick a format. CSV exports any range; Excel & PDF require a single rep and a From date.</div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Rep */}
            <div>
              <Label style={{ fontSize: 11, fontWeight: 600, color: A.inkSoft, letterSpacing: 0.3, textTransform: "uppercase" }}>Rep</Label>
              <div style={{ marginTop: 5 }}>
                <SearchableSelect
                  value={repFilter}
                  onValueChange={setRepFilter}
                  options={reps.map((r) => ({ value: r.id, label: r.rep_name }))}
                  placeholder="All reps"
                  searchPlaceholder="Search reps…"
                  includeAll
                  allLabel="All reps"
                  className="w-full"
                />
              </div>
              <div style={{ fontSize: 10.5, color: A.inkMute, marginTop: 4 }}>Required for Excel & PDF · CSV may use "All reps".</div>
            </div>

            {/* Customer */}
            <div>
              <Label style={{ fontSize: 11, fontWeight: 600, color: A.inkSoft, letterSpacing: 0.3, textTransform: "uppercase" }}>Customer</Label>
              <div style={{ marginTop: 5 }}>
                <SearchableSelect
                  value={custFilter}
                  onValueChange={setCustFilter}
                  options={customers.map((c) => ({ value: c.id, label: c.customer_name + (c.area ? ` (${c.area})` : "") }))}
                  placeholder="All customers"
                  searchPlaceholder="Search customers…"
                  includeAll
                  allLabel="All customers"
                  className="w-full"
                />
              </div>
            </div>

            {/* Date range */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <Label style={{ fontSize: 11, fontWeight: 600, color: A.inkSoft, letterSpacing: 0.3, textTransform: "uppercase" }}>From</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ height: 34, fontSize: 12, fontFamily: A.mono, background: A.panel, borderColor: A.border, marginTop: 5 }} />
              </div>
              <div>
                <Label style={{ fontSize: 11, fontWeight: 600, color: A.inkSoft, letterSpacing: 0.3, textTransform: "uppercase" }}>
                  To <span style={{ color: A.inkMute, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span>
                </Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ height: 34, fontSize: 12, fontFamily: A.mono, background: A.panel, borderColor: A.border, marginTop: 5 }} />
              </div>
            </div>

            {/* Quick range chips */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => {
                  const yesterday = new Date();
                  yesterday.setDate(yesterday.getDate() - 1);
                  const yStr = yesterday.toISOString().slice(0, 10);
                  setDateFrom(yStr);
                  setDateTo(yStr);
                }}
                style={{ padding: "4px 9px", borderRadius: 5, background: A.borderSoft, color: A.inkSoft, border: "none", fontSize: 11, fontFamily: A.sans, fontWeight: 500, cursor: "pointer" }}
              >
                Yesterday
              </button>
              {[
                { label: "Today",     offset: 0 },
                { label: "7 days",    offset: 7 },
                { label: "30 days",   offset: 30 },
                { label: "All time",  offset: null as number | null },
              ].map((r) => (
                <button
                  key={r.label}
                  type="button"
                  onClick={() => setRange(r.offset)}
                  style={{ padding: "4px 9px", borderRadius: 5, background: A.borderSoft, color: A.inkSoft, border: "none", fontSize: 11, fontFamily: A.sans, fontWeight: 500, cursor: "pointer" }}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ height: 1, background: A.borderSoft, margin: "20px 0" }} />

          {/* Three action buttons */}
          <div style={{ fontSize: 11, fontWeight: 600, color: A.inkSoft, letterSpacing: 0.3, textTransform: "uppercase", marginBottom: 9 }}>Generate</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <ExportAction
              icon={<FileSpreadsheet size={14} />}
              label="Visits CSV"
              desc="Raw rows — every visit in the range. Good for spreadsheets and BI imports."
              meta="Works with all reps"
              onClick={exportVisits}
            />
            <ExportAction
              icon={<FileSpreadsheet size={14} />}
              label="Excel report"
              desc="Styled .xlsx — title banner, KPI strip, per-visit table, totals row."
              meta={canExportSingleRep ? "Ready" : "Pick a rep + From date"}
              ready={canExportSingleRep}
              onClick={exportReportExcel}
            />
            <ExportAction
              icon={<FileSpreadsheet size={14} />}
              label="PDF report"
              desc="Landscape A4 — same layout as Excel, fits one rep one day."
              meta={canExportSingleRep ? "Ready" : "Pick a rep + From date"}
              ready={canExportSingleRep}
              onClick={exportReportPDF}
            />
          </div>
        </div>

        {/* ───────────── RIGHT: live preview ───────────── */}
        <div style={{ overflow: "auto", padding: "22px 28px", background: A.bg }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: A.ink }}>Preview · Excel/PDF report</div>
              <div style={{ fontSize: 11.5, color: A.inkMute, marginTop: 2 }}>
                {repLabel} · {periodLabel}{custLabel !== "All customers" ? ` · ${custLabel}` : ""}
              </div>
            </div>
          </div>

          {/* Paper-style frame mirroring the actual xlsx output */}
          <div style={{ background: A.panel, border: `1px solid ${A.border}`, borderRadius: 8, padding: 18, boxShadow: "0 1px 0 rgba(23,23,21,0.04), 0 8px 20px -10px rgba(23,23,21,0.10)" }}>

            {/* Navy banner — matches NAVY (#1B2A4A) + ACCENT (#2E5090) constants in the file */}
            <div style={{ background: "#1B2A4A", color: "#fff", padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, borderBottom: "3px solid #2E5090" }}>
              <div style={{ width: 28, height: 28, background: "#fff", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", color: "#1B2A4A", fontWeight: 700, fontSize: 11, fontFamily: A.sans }}>CIT</div>
              <div>
                <div style={{ fontFamily: A.sans, fontWeight: 700, fontSize: 14, lineHeight: 1.1 }}>{repLabel}</div>
                <div style={{ fontFamily: A.sans, fontSize: 10.5, color: "#b4cde1", marginTop: 3 }}>{periodLabel}</div>
              </div>
            </div>

            {/* 3-block info summary — labels/values illustrative */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderTop: `1px solid ${A.border}`, borderBottom: `1px solid ${A.border}` }}>
              <SummaryBlock rows={[["Name", repLabel], ["Date", "—"], ["Period", periodLabel], ["Visits", "—"]]} />
              <SummaryBlock rows={[["Travel Time", "—"], ["Expected Productive Time", "—"], ["Total Customers on Route", "—"], ["Time / Customer", "—"]]} />
              <SummaryBlock rows={[["Productive Time", "—"], ["Order Qty", "—"], ["Order Amount (R)", "—"], ["Skipped", "—"]]} last />
            </div>

            {/* Table preview — illustrative rows + a skipped row to show the red styling */}
            <div style={{ marginTop: 14, border: `1px solid ${A.border}`, borderRadius: 4, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "32px 80px 1.5fr 90px 70px 70px 60px 80px 50px 90px 1fr 70px", padding: "8px 10px", background: "#1B2A4A", color: "#fff", fontSize: 10, fontWeight: 700, letterSpacing: 0.3, fontFamily: A.sans }}>
                <div>#</div><div>Acct #</div><div>Customer</div><div>Area</div><div>Arr</div><div>Dep</div><div>Dur</div><div>Order #</div><div>Qty</div><div style={{ textAlign: "right" }}>R</div><div>Notes</div><div>Status</div>
              </div>
              {[
                { idx: 1, acc: "EXAMPLE", cust: "Example Customer A",  area: "—", arr: "—", dep: "—", dur: "—", po: "—", qty: "—", amt: "—", note: "Live data populates from your filter.", status: "Visited" },
                { idx: 2, acc: "EXAMPLE", cust: "Example Skipped Row", area: "—", arr: "—", dep: "—", dur: "—", po: "—", qty: "—", amt: "—", note: "[SKIPPED] Closed for renovations",         status: "Skipped", skip: true },
                { idx: 3, acc: "EXAMPLE", cust: "Example Off-route",   area: "—", arr: "—", dep: "—", dur: "—", po: "—", qty: "—", amt: "—", note: "[OFF-ROUTE] Walk-in order",               status: "Off-route" },
              ].map((r, i) => {
                const bg = r.skip ? "#FFE0E0" : i % 2 === 1 ? "#F5F2ED" : "#FFFFFF";
                const color = r.skip ? "#991B1B" : "#1A1A1A";
                return (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "32px 80px 1.5fr 90px 70px 70px 60px 80px 50px 90px 1fr 70px", padding: "7px 10px", fontSize: 10.5, color, background: bg, borderTop: `1px solid ${A.border}`, fontFamily: A.sans, alignItems: "center" }}>
                    <div style={{ fontFamily: A.mono }}>{r.idx}</div>
                    <div style={{ fontFamily: A.mono }}>{r.acc}</div>
                    <div style={{ fontWeight: 500 }}>{r.cust}</div>
                    <div>{r.area}</div>
                    <div style={{ fontFamily: A.mono }}>{r.arr}</div>
                    <div style={{ fontFamily: A.mono }}>{r.dep}</div>
                    <div style={{ fontFamily: A.mono }}>{r.dur}</div>
                    <div style={{ fontFamily: A.mono }}>{r.po}</div>
                    <div style={{ fontFamily: A.mono }}>{r.qty}</div>
                    <div style={{ fontFamily: A.mono, textAlign: "right" }}>{r.amt}</div>
                    <div style={{ fontSize: 10, fontStyle: r.note ? "italic" : "normal", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.note}</div>
                    <div style={{ fontSize: 10 }}>{r.status}</div>
                  </div>
                );
              })}
              <div style={{ display: "grid", gridTemplateColumns: "32px 80px 1.5fr 90px 70px 70px 60px 80px 50px 90px 1fr 70px", padding: "8px 10px", background: "#1B2A4A", color: "#fff", fontSize: 10.5, fontWeight: 700, fontFamily: A.sans, borderTop: `1px solid ${A.border}` }}>
                <div>Tot</div><div /><div /><div /><div /><div /><div style={{ fontFamily: A.mono }}>—</div><div /><div style={{ fontFamily: A.mono }}>—</div><div style={{ fontFamily: A.mono, textAlign: "right" }}>—</div><div /><div />
              </div>
            </div>

            <div style={{ marginTop: 12, fontSize: 11, color: A.inkMute, fontFamily: A.sans }}>
              The actual export reads <span style={{ fontFamily: A.mono }}>buildReportData()</span> with your live filters and uses the same banner colours and totals layout.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}