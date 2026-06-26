import { useState, useLayoutEffect, useRef } from "react";
import { Check, SkipForward, WifiOff } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { addOfflineVisit } from "@/lib/offlineDb";

// ─── mobile zoom reset ────────────────────────────────────────────────────────
// Safety net: resets any residual viewport zoom after an input loses focus.
// The primary fix is the 16px font-size rule in index.css; this handles edge
// cases on older WebKit browsers that zoom despite the font-size being 16px.
export function resetMobileZoom() {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) {
    viewport.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1');
    setTimeout(() => {
      viewport.setAttribute('content', 'width=device-width, initial-scale=1');
    }, 100);
  }
}

// ─── color palette ────────────────────────────────────────────────────────────
export const C = {
  bg:         '#F1ECE0',
  surface:    '#FFFFFF',
  surfaceAlt: '#F8F3E6',
  ink:        '#171715',
  inkSoft:    '#535048',
  inkMute:    '#928D81',
  green:      '#1B5238',
  greenDeep:  '#0D2E1F',
  greenMid:   '#2A6F4A',
  greenSoft:  '#DDE9E1',
  greenInk:   '#0E3A24',
  cream:      '#F4ECDB',
  sun:        '#E6B652',
  border:     '#E7DEC9',
  danger:     '#B85A4A',
  dangerSoft: '#F4DCD4',
};

// ─── helpers (preserved verbatim) ─────────────────────────────────────────────

export function isOfflineError(err: any): boolean {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("load failed") ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed")
  );
}

export async function saveVisitOffline(
  repId: string,
  customerId: string,
  scheduleDate: string,
  arrivalTime: string | null,
  leavingTime: string | null,
  durationMinutes: number,
  notes: string | null,
  customerName?: string,
  status?: string,
  photoBase64?: string | null,
  orderNumber?: string | null,
  orderQuantity?: number | null,
  orderAmount?: number | null,
) {
  const clientId = uuidv4();
  await addOfflineVisit({
    client_generated_id: clientId,
    payload: {
      rep_id: repId,
      customer_id: customerId,
      visit_date: scheduleDate,
      arrival_time: arrivalTime,
      leaving_time: leavingTime,
      duration_minutes: durationMinutes,
      notes,
      client_generated_id: clientId,
      ...(status ? { status } : {}),
      ...(orderNumber !== undefined ? { order_number: orderNumber } : {}),
      ...(orderQuantity !== undefined ? { order_quantity: orderQuantity } : {}),
      ...(orderAmount !== undefined ? { order_amount: orderAmount } : {}),
    } as any,
    created_at_local: new Date().toISOString(),
    sync_status: "pending",
    last_sync_attempt: null,
    error_message: null,
    customer_name: customerName,
    photo_base64: photoBase64 ?? null,
  });
}

export function nowTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

export function calcDuration(arr: string, lv: string): number {
  if (!arr || !lv) return 0;
  const [ah, am] = arr.split(":").map(Number);
  const [lh, lm] = lv.split(":").map(Number);
  return lh * 60 + lm - (ah * 60 + am);
}

// ─── small UI helpers ──────────────────────────────────────────────────────────

export function StatusPill({ status, isInProgress }: { status: string; isInProgress: boolean }) {
  if (status === "visited")
    return (
      <span style={{ background: C.greenSoft, color: C.greenInk }} className="text-[11px] font-semibold px-2 py-0.5 rounded-full font-syne flex items-center gap-1">
        <Check size={11} /> Visited
      </span>
    );
  if (status === "skipped")
    return (
      <span style={{ background: C.dangerSoft, color: C.danger }} className="text-[11px] font-semibold px-2 py-0.5 rounded-full font-syne flex items-center gap-1">
        <SkipForward size={11} /> Skipped
      </span>
    );
  if (isInProgress)
    return (
      <span style={{ background: C.surfaceAlt, color: C.inkSoft }} className="text-[11px] font-semibold px-2 py-0.5 rounded-full font-syne">
        Arriving
      </span>
    );
  return (
    <span style={{ background: C.cream, color: C.inkMute }} className="text-[11px] font-medium px-2 py-0.5 rounded-full font-syne">
      Pending
    </span>
  );
}

export function OfflineBanner() {
  return (
    <div style={{ background: "#FFF3E0", color: C.sun, borderColor: "#FFB74D" }}
      className="flex items-center gap-2 text-xs font-medium px-3 py-2 border-b">
      <WifiOff size={13} /> You're offline — changes will sync when reconnected
    </div>
  );
}

// ─── Expand (animated height collapse) ────────────────────────────────────────

export function Expand({ open, children, duration = 320 }: { open: boolean; children: React.ReactNode; duration?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | "auto">(open ? "auto" : 0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (open) {
      const target = el.scrollHeight;
      setH(0);
      requestAnimationFrame(() => setH(target));
      const t = setTimeout(() => setH("auto"), duration);
      return () => clearTimeout(t);
    } else {
      const cur = el.scrollHeight;
      setH(cur);
      requestAnimationFrame(() => setH(0));
    }
  }, [open, duration]);

  return (
    <div
      ref={ref}
      style={{
        height: typeof h === "number" ? `${h}px` : h,
        overflow: "hidden",
        transition: `height ${duration}ms cubic-bezier(0.22,0.61,0.36,1)`,
        opacity: open ? 1 : 0.001,
      }}
    >
      <div
        style={{
          transform: open ? "translateY(0)" : "translateY(-6px)",
          opacity: open ? 1 : 0,
          transition: `transform ${duration}ms cubic-bezier(0.22,0.61,0.36,1), opacity ${(duration * 0.7).toFixed(0)}ms ease`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
