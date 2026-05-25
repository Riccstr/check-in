import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useVisitDetails } from "@/hooks/useVisitDetails";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  CalendarDays, Clock, Check, SkipForward, Plus, Loader2, X, Pencil,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Home, ClipboardList, User, Wifi, WifiOff, MapPin, Camera, FileText, Lock, Pin, LogOut,
} from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { compressImage, blobToBase64 } from "@/lib/imageCompressor";
import { CameraCapture } from "@/components/CameraCapture";
import { fmtDuration } from "@/lib/timeUtils";
import {
  addOfflineVisit,
  getCachedCustomers,
  setCachedCustomers,
  setCachedSchedule,
  getCachedSchedule,
  upsertOfflineScheduleItemUpdate,
  updateCachedScheduleItem,
  savePendingPhoto,
  getPendingPhoto,
  clearPendingPhoto,
  getAllPendingPhotos,
  saveActiveCard,
  getActiveCard,
  clearActiveCard,
} from "@/lib/offlineDb";

// ─── mobile zoom reset ────────────────────────────────────────────────────────
// Safety net: resets any residual viewport zoom after an input loses focus.
// The primary fix is the 16px font-size rule in index.css; this handles edge
// cases on older WebKit browsers that zoom despite the font-size being 16px.
function resetMobileZoom() {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) {
    viewport.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1');
    setTimeout(() => {
      viewport.setAttribute('content', 'width=device-width, initial-scale=1');
    }, 100);
  }
}

// ─── color palette ────────────────────────────────────────────────────────────
const C = {
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

function isOfflineError(err: any): boolean {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("load failed") ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed")
  );
}

async function saveVisitOffline(
  repId: string,
  customerId: string,
  scheduleDate: string,
  arrivalTime: string,
  leavingTime: string,
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

function nowTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function calcDuration(arr: string, lv: string): number {
  if (!arr || !lv) return 0;
  const [ah, am] = arr.split(":").map(Number);
  const [lh, lm] = lv.split(":").map(Number);
  return lh * 60 + lm - (ah * 60 + am);
}

// ─── small UI helpers ──────────────────────────────────────────────────────────

function StatusPill({ status, isInProgress }: { status: string; isInProgress: boolean }) {
  if (status === "visited")
    return (
      <span style={{ background: C.greenBg, color: C.green }} className="text-[11px] font-semibold px-2 py-0.5 rounded-full font-syne flex items-center gap-1">
        <Check size={11} /> Visited
      </span>
    );
  if (status === "skipped")
    return (
      <span style={{ background: C.redBg, color: C.red }} className="text-[11px] font-semibold px-2 py-0.5 rounded-full font-syne flex items-center gap-1">
        <SkipForward size={11} /> Skipped
      </span>
    );
  if (isInProgress)
    return (
      <span style={{ background: C.orangeBg, color: C.orange }} className="text-[11px] font-semibold px-2 py-0.5 rounded-full font-syne">
        Arriving
      </span>
    );
  return (
    <span style={{ background: C.border, color: C.textMuted }} className="text-[11px] font-medium px-2 py-0.5 rounded-full font-syne">
      Pending
    </span>
  );
}

function OfflineBanner() {
  return (
    <div style={{ background: "#FFF3E0", color: C.orange, borderColor: "#FFB74D" }}
      className="flex items-center gap-2 text-xs font-medium px-3 py-2 border-b">
      <WifiOff size={13} /> You're offline — changes will sync when reconnected
    </div>
  );
}

// ─── EodSummaryModal ──────────────────────────────────────────────────────────

interface SummaryStats {
  total: number;
  visited: number;
  skipped: number;
  orders: number;
  totalOrderValue: number;
  avgDuration: number; // minutes
  histAvgOrders: number | null;     // null = fewer than 2 historical days, don't show
  histAvgOrderValue: number | null; // null = fewer than 2 historical days, don't show
}

function EodSummaryModal({ stats, onClose }: { stats: SummaryStats; onClose: () => void }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        background: "rgba(13, 46, 31, 0.45)",
        backdropFilter: "blur(2px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          background: C.surface,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          display: "flex",
          flexDirection: "column",
          maxHeight: "90vh",
          overflow: "auto",
        }}
      >
        {/* Radial gradient header */}
        <div
          style={{
            background: `radial-gradient(140% 60% at 50% 0%, ${C.greenSoft} 0%, ${C.surface} 35%, ${C.surface} 100%)`,
            paddingTop: 32,
            paddingBottom: 40,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            position: "relative",
          }}
        >
          {/* Grabber */}
          <div
            style={{
              position: "absolute",
              top: 12,
              width: 38,
              height: 4,
              borderRadius: 999,
              background: C.cream,
            }}
          />

          {/* Hero circle */}
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: `linear-gradient(135deg, ${C.greenMid} 0%, ${C.green} 100%)`,
              boxShadow: `0 8px 24px rgba(27, 82, 56, 0.25)`,
            }}
          >
            <Check size={32} style={{ color: "#fff", strokeWidth: 2.8 }} />
          </div>

          {/* Title */}
          <h2 style={{ fontFamily: "Syne, sans-serif", fontSize: 24, fontWeight: 700, color: C.ink, margin: 0 }}>
            Day complete
          </h2>
        </div>

        {/* Content */}
        <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* 3-col row: Scheduled, Visited, Skipped */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {[
              { label: "Scheduled", value: stats.total, color: C.ink },
              { label: "Visited", value: stats.visited, color: C.green },
              { label: "Skipped", value: stats.skipped, color: C.ink },
            ].map((item, i) => (
              <div
                key={i}
                style={{
                  padding: "12px 10px",
                  borderRadius: 12,
                  background: C.surfaceAlt,
                  border: `1px solid ${C.border}`,
                  textAlign: "center",
                }}
              >
                <p style={{ fontSize: 10, fontWeight: 500, color: C.inkMute, textTransform: "uppercase", margin: 0, marginBottom: 6 }}>
                  {item.label}
                </p>
                <p style={{ fontSize: 24, fontWeight: 700, fontFamily: "Syne, sans-serif", color: item.color, margin: 0 }}>
                  {item.value}
                </p>
              </div>
            ))}
          </div>

          {/* 2-col row: Orders, Avg Time */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            {/* Orders */}
            <div style={{ padding: "12px 10px", borderRadius: 12, background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
              <p style={{ fontSize: 10, fontWeight: 500, color: C.inkMute, textTransform: "uppercase", margin: 0, marginBottom: 6 }}>
                Orders
              </p>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <p style={{ fontSize: 24, fontWeight: 700, fontFamily: "Syne, sans-serif", color: C.green, margin: 0 }}>
                  {stats.orders}
                </p>
                {stats.histAvgOrders !== null && (
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: stats.orders > stats.histAvgOrders ? C.green : stats.orders < stats.histAvgOrders ? C.danger : C.inkMute,
                      display: "flex",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    {stats.orders > stats.histAvgOrders && <span>▲</span>}
                    {stats.orders < stats.histAvgOrders && <span>▼</span>}
                    {stats.histAvgOrders.toFixed(1)}
                  </div>
                )}
              </div>
            </div>

            {/* Avg Time */}
            <div style={{ padding: "12px 10px", borderRadius: 12, background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
              <p style={{ fontSize: 10, fontWeight: 500, color: C.inkMute, textTransform: "uppercase", margin: 0, marginBottom: 6 }}>
                Avg Time
              </p>
              <p style={{ fontSize: 24, fontWeight: 700, fontFamily: "Syne, sans-serif", color: C.ink, margin: 0 }}>
                {fmtDuration(stats.avgDuration)}
              </p>
            </div>
          </div>

          {/* Full-width Order Value with delta */}
          <div style={{ padding: "12px 10px", borderRadius: 12, background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
            <p style={{ fontSize: 10, fontWeight: 500, color: C.inkMute, textTransform: "uppercase", margin: 0, marginBottom: 6 }}>
              Order Value
            </p>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <p style={{ fontSize: 24, fontWeight: 700, fontFamily: "Syne, sans-serif", color: C.green, margin: 0 }}>
                R {stats.totalOrderValue.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
              </p>
              {stats.histAvgOrderValue !== null && (
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: stats.totalOrderValue > stats.histAvgOrderValue ? C.green : stats.totalOrderValue < stats.histAvgOrderValue ? C.danger : C.inkMute,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  {stats.totalOrderValue > stats.histAvgOrderValue && <span>▲</span>}
                  {stats.totalOrderValue < stats.histAvgOrderValue && <span>▼</span>}
                  R {stats.histAvgOrderValue.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
              )}
            </div>
          </div>

          {/* Wrap up button */}
          <button
            type="button"
            onClick={onClose}
            style={{
              height: 56,
              width: "100%",
              borderRadius: 16,
              background: `linear-gradient(135deg, ${C.greenMid} 0%, ${C.green} 100%)`,
              color: "#fff",
              border: "none",
              fontSize: 15,
              fontWeight: 600,
              fontFamily: "Syne, sans-serif",
              cursor: "pointer",
              marginTop: 8,
            }}
          >
            Wrap up
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── VisitDetailsText / VisitPhotoOnly ────────────────────────────────────────
// Split components for completed visit data. Both use two lookup strategies to
// handle offline-synced visits where visit_id may not yet be on schedule_items.

function VisitDetailsText({ visitId, repId, customerId, scheduleDate }: { visitId: string | null; repId: string; customerId: string; scheduleDate: string }) {
  const { data: visitData } = useVisitDetails(visitId, repId, customerId, scheduleDate, "order_number, order_quantity, order_amount");

  if (!visitData) return null;
  const hasAny = visitData.order_number || visitData.order_quantity != null || visitData.order_amount != null;
  if (!hasAny) return null;

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {visitData.order_number && (
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-medium" style={{ color: C.textMuted }}>Order:</span>
          <span className="text-sm" style={{ color: C.text }}>{visitData.order_number}</span>
        </div>
      )}
      {visitData.order_quantity != null && (
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-medium" style={{ color: C.textMuted }}>Qty:</span>
          <span className="text-sm" style={{ color: C.text }}>{visitData.order_quantity}</span>
        </div>
      )}
      {visitData.order_amount != null && (
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-medium" style={{ color: C.textMuted }}>Amt:</span>
          <span className="text-sm" style={{ color: C.text }}>R {Number(visitData.order_amount).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</span>
        </div>
      )}
    </div>
  );
}

function VisitPhotoOnly({ visitId, repId, customerId, scheduleDate }: { visitId: string | null; repId: string; customerId: string; scheduleDate: string }) {
  const { data } = useVisitDetails(visitId, repId, customerId, scheduleDate, "photo_url");

  if (!data?.photo_url) return null;

  return (
    <div className="shrink-0">
      <img src={data.photo_url} alt="Visit photo" className="w-16 h-16 object-cover rounded-xl" style={{ border: `1px solid ${C.border}` }} />
    </div>
  );
}

// ─── Expand (animated height collapse) ────────────────────────────────────────

function Expand({ open, children, duration = 320 }: { open: boolean; children: React.ReactNode; duration?: number }) {
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

// ─── ScheduleCard ─────────────────────────────────────────────────────────────

function ScheduleCard({
  item,
  repId,
  scheduleDate,
  onRefresh,
  onLocalUpdate,
  isExpanded,
  onToggle,
  index,
  allItems,
}: {
  item: any;
  repId: string;
  scheduleDate: string;
  onRefresh: () => void;
  onLocalUpdate: (itemId: string, updates: any) => void;
  isExpanded: boolean;
  onToggle: () => void;
  index: number;
  allItems: any[];
}) {
  const [localNotes, setLocalNotes]           = useState(item.notes || "");
  const [localArrival, setLocalArrival]       = useState(item.arrival_time || "");
  const [localLeaving, setLocalLeaving]       = useState(item.leaving_time || "");
  const [localOrderNumber, setLocalOrderNumber] = useState("");
  const [localOrderQty, setLocalOrderQty]       = useState("");
  const [localOrderAmount, setLocalOrderAmount] = useState("");
  const [actionInProgress, setActionInProgress] = useState(false);

  const [editingDone, setEditingDone]         = useState(false);
  const [doneOrderNumber, setDoneOrderNumber] = useState("");
  const [doneOrderQty, setDoneOrderQty]       = useState("");
  const [doneOrderAmount, setDoneOrderAmount] = useState("");

  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoBlob, setPhotoBlob]       = useState<Blob | null>(null);

  // Tracks the Supabase visits.id created at online arrival so checkout can PATCH it.
  const [activeVisitId, setActiveVisitId] = useState<string | null>(null);
  // Stable UUID for the current visit session — used as conflict key in the arrival upsert.
  const clientGenIdRef = useRef<string | null>(null);

  // Skip flow state — tracks whether skip composer is open and the note being entered
  const [skipMode, setSkipMode] = useState(false);
  const [skipNote, setSkipNote] = useState("");

  useEffect(() => { setLocalNotes(item.notes || "");     }, [item.notes]);
  useEffect(() => { setLocalArrival(item.arrival_time || ""); }, [item.arrival_time]);
  useEffect(() => { setLocalLeaving(item.leaving_time || ""); }, [item.leaving_time]);

  // Restore captured photo from IndexedDB on mount (survives app background/resume)
  useEffect(() => {
    if (!item.arrival_time || item.leaving_time) return;
    getPendingPhoto(item.id).then((base64) => {
      if (!base64) return;
      try {
        const raw = base64.includes(",") ? base64.split(",")[1] : base64;
        const byteStr = atob(raw);
        const arr = new Uint8Array(byteStr.length);
        for (let i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i);
        const blob = new Blob([arr], { type: "image/jpeg" });
        setPhotoBlob(blob);
        setPhotoPreview(URL.createObjectURL(blob));
      } catch { /* corrupt base64 — ignore */ }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore unsaved notes from IndexedDB on mount (runs after the item.notes sync above)
  useEffect(() => {
    if (!item.arrival_time || item.leaving_time) return;
    getActiveCard().then((card) => {
      if (card?.scheduleItemId === item.id && card.notes) {
        setLocalNotes(card.notes);
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Silent pre-fill from IndexedDB when this card is expanded.
  // Runs whenever isExpanded flips to true. Only fills fields that the server
  // hasn't populated yet — never overwrites a value that came from the server.
  // Also restores activeVisitId / clientGeneratedId so the PATCH path is used at checkout.
  useEffect(() => {
    if (!isExpanded) return;
    (async () => {
      try {
        const card = await getActiveCard();
        if (!card || card.scheduleItemId !== item.id) return;
        if (!item.arrival_time && card.arrivalTime) {
          setLocalArrival(card.arrivalTime);
        }
        if (!item.notes && card.notes) {
          setLocalNotes(card.notes);
        }
        if (card.visitId && !activeVisitId) {
          setActiveVisitId(card.visitId);
        }
        if (card.clientGeneratedId && !clientGenIdRef.current) {
          clientGenIdRef.current = card.clientGeneratedId;
        }
      } catch {
        // IDB unavailable — do nothing silently
      }
    })();
  }, [isExpanded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Part C — on reconnect, restore activeVisitId from IDB so that checkout uses
  // the PATCH path rather than inserting a duplicate visit row.
  useEffect(() => {
    if (!isExpanded) return;
    const onOnline = async () => {
      if (activeVisitId) return; // already restored
      try {
        const card = await getActiveCard();
        if (card?.scheduleItemId === item.id) {
          if (card.visitId) setActiveVisitId(card.visitId);
          if (card.clientGeneratedId && !clientGenIdRef.current) {
            clientGenIdRef.current = card.clientGeneratedId;
          }
        }
      } catch { /* IDB unavailable — do nothing */ }
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [isExpanded, activeVisitId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-persist notes to IndexedDB while a visit is in-progress.
  // Merges with any visitId / clientGeneratedId already in the stored record so
  // that the notes sync doesn't accidentally clobber the PATCH routing fields.
  useEffect(() => {
    if (!item.arrival_time || item.leaving_time) return;
    saveActiveCard({
      scheduleItemId: item.id,
      arrivalTime: item.arrival_time,
      notes: localNotes,
      visitId: activeVisitId,
      clientGeneratedId: clientGenIdRef.current,
    }).catch(() => {});
  }, [localNotes]); // eslint-disable-line react-hooks/exhaustive-deps

  const queueScheduleItemUpdate = async (newItem: any) => {
    // Resolve visitId: prefer component state, fall back to IDB for the
    // offline-at-arrival → offline-at-checkout case.
    let queueVisitId: string | null = activeVisitId;
    if (!queueVisitId) {
      try {
        const card = await getActiveCard();
        if (card?.scheduleItemId === item.id && card.visitId) queueVisitId = card.visitId;
      } catch { /* IDB unavailable */ }
    }

    await upsertOfflineScheduleItemUpdate({
      schedule_item_id: item.id,
      rep_id: repId,
      schedule_date: scheduleDate,
      customer_id: item.customer_id,
      visitId: queueVisitId,
      payload: {
        arrival_time: newItem.arrival_time || null,
        leaving_time: newItem.leaving_time || null,
        duration_minutes: newItem.duration_minutes ?? null,
        notes: newItem.notes || null,
        status: newItem.status || "pending",
        order_number: newItem.order_number ?? undefined,
        order_quantity: newItem.order_quantity ?? undefined,
        order_amount: newItem.order_amount ?? undefined,
      },
      created_at_local: new Date().toISOString(),
      sync_status: "pending",
      last_sync_attempt: null,
      error_message: null,
    });
  };

  const handleCameraCapture = async (blob: Blob) => {
    try {
      const compressed = await compressImage(blob);
      setPhotoBlob(compressed);
      setPhotoPreview(URL.createObjectURL(compressed));
      // Persist immediately so a background/resume cycle cannot lose the photo
      blobToBase64(compressed).then((b64) => savePendingPhoto(item.id, b64, null, null)).catch(() => {});
    } catch {
      toast.error("Failed to process photo");
    }
  };

  const clearPhoto = () => {
    setPhotoBlob(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
    clearPendingPhoto(item.id).catch(() => {});
  };

  const uploadPhotoOnline = async (visitId: string, clientGeneratedId: string | null = null): Promise<string | null> => {
    if (!photoBlob) return null;
    const queuePhoto = async () => {
      try {
        const b64 = await blobToBase64(photoBlob);
        await savePendingPhoto(item.id, b64, visitId, clientGeneratedId);
        toast.warning("Photo saved for upload — will retry when connection improves");
      } catch { /* IDB write failure must not block checkout */ }
    };
    try {
      const path = `${repId}/${visitId}.jpg`;
      const { error } = await supabase.storage
        .from("visit-photos")
        .upload(path, photoBlob, { contentType: "image/jpeg", upsert: true });
      if (error) {
        console.warn("[Photo] Upload failed:", error.message);
        await queuePhoto();
        return null;
      }
      const { data: urlData } = supabase.storage.from("visit-photos").getPublicUrl(path);
      return urlData?.publicUrl || null;
    } catch {
      await queuePhoto();
      return null;
    }
  };

  const updateItem = async (
    updates: Partial<{ arrival_time: string; leaving_time: string; notes: string; status: string; duration_minutes: number; order_number: string | null; order_quantity: number | null; order_amount: number | null }>
  ) => {
    if (actionInProgress) return;
    setActionInProgress(true);

    const newItem = { ...item, ...updates };
    if (newItem.arrival_time && newItem.leaving_time) {
      newItem.duration_minutes = calcDuration(newItem.arrival_time, newItem.leaving_time);
    }

    onLocalUpdate(item.id, {
      arrival_time: newItem.arrival_time || null,
      leaving_time: newItem.leaving_time || null,
      duration_minutes: newItem.duration_minutes || null,
      notes: newItem.notes || null,
      status: newItem.status,
    });

    try {
      if (!navigator.onLine) {
        await queueScheduleItemUpdate(newItem);
        // Skip offline visit INSERT when the visit was already created at arrival
        if (!activeVisitId) await handleOfflineVisitSave(newItem);
        return;
      }

      const { error } = await supabase
        .from("schedule_items")
        .update({
          arrival_time: newItem.arrival_time || null,
          leaving_time: newItem.leaving_time || null,
          duration_minutes: newItem.duration_minutes || null,
          notes: newItem.notes || null,
          status: newItem.status,
        })
        .eq("id", item.id);

      if (error) {
        if (isOfflineError(error)) {
          await queueScheduleItemUpdate(newItem);
          if (!activeVisitId) await handleOfflineVisitSave(newItem);
          return;
        }
        toast.error(error.message);
        return;
      }

      if (
        newItem.status === "visited" &&
        newItem.arrival_time &&
        newItem.leaving_time &&
        newItem.duration_minutes >= 0
      ) {
        const checkoutData: any = {
          arrival_time: newItem.arrival_time,
          leaving_time: newItem.leaving_time,
          duration_minutes: newItem.duration_minutes,
          notes: newItem.notes || null,
          order_number: newItem.order_number ?? null,
          order_quantity: newItem.order_quantity ?? null,
          order_amount: newItem.order_amount ?? null,
          status: "visited",
        };

        // ── Resolve the visit id to PATCH (state → IDB → fall through to legacy) ──
        let patchVisitId: string | null = activeVisitId;
        if (!patchVisitId) {
          try {
            const card = await getActiveCard();
            if (card?.scheduleItemId === item.id && card.visitId) {
              patchVisitId = card.visitId;
              setActiveVisitId(card.visitId); // sync state for future calls
              if (card.clientGeneratedId && !clientGenIdRef.current) {
                clientGenIdRef.current = card.clientGeneratedId;
              }
            }
          } catch { /* IDB unavailable */ }
        }

        // Also fall back to client_generated_id upsert if patchVisitId is
        // still null but clientGenIdRef.current exists — this handles the
        // case where arrival upsert succeeded but visitId was never stored
        if (!patchVisitId && clientGenIdRef.current) {
          try {
            const { data } = await supabase
              .from("visits")
              .select("id")
              .eq("client_generated_id", clientGenIdRef.current)
              .maybeSingle();
            if (data?.id) {
              patchVisitId = data.id;
              setActiveVisitId(data.id);
            }
          } catch { /* DB unavailable */ }
        }

        if (patchVisitId) {
          // ── PATCH path: visit was already inserted at arrival ──
          const photoUrl = await uploadPhotoOnline(patchVisitId, clientGenIdRef.current);
          const { error: patchErr } = await supabase.from("visits").update({
            ...checkoutData,
            ...(photoUrl ? { photo_url: photoUrl } : {}),
          } as any).eq("id", patchVisitId);

          if (patchErr) {
            if (isOfflineError(patchErr)) {
              await queueScheduleItemUpdate(newItem);
              // Visit already exists — do NOT queue a duplicate INSERT
              toast.success("Saved offline. Will sync when online.");
              return;
            }
            console.error("[Schedule] visit patch error:", patchErr.code, patchErr.message, patchErr.details, patchErr.hint);
          } else {
            await supabase.from("schedule_items").update({ visit_id: patchVisitId }).eq("id", item.id);
            setActiveVisitId(null);
          }
        } else if (item.visit_id) {
          // ── Legacy update: visit_id already linked on schedule_item ──
          const { error: updateErr } = await supabase.from("visits").update(checkoutData).eq("id", item.visit_id);
          if (updateErr) console.error("[Schedule] visit update error:", updateErr.code, updateErr.message, updateErr.details, updateErr.hint);
          const photoUrl = await uploadPhotoOnline(item.visit_id, null);
          if (photoUrl)
            await supabase.from("visits").update({ photo_url: photoUrl } as any).eq("id", item.visit_id);
        } else {
          // ── Insert path: no prior visit row exists ──
          // Guard: check if a visited row already exists for this visit
          const { data: existing } = await supabase
            .from("visits")
            .select("id")
            .eq("rep_id", repId)
            .eq("customer_id", item.customer_id)
            .eq("visit_date", scheduleDate)
            .eq("arrival_time", newItem.arrival_time)
            .maybeSingle();

          if (existing?.id) {
            // Row already exists — PATCH it instead of inserting a duplicate
            await supabase.from("visits").update(checkoutData).eq("id", existing.id);
            await supabase.from("schedule_items").update({ visit_id: existing.id }).eq("id", item.id);
            const photoUrl = await uploadPhotoOnline(existing.id, clientGenIdRef.current);
            if (photoUrl)
              await supabase.from("visits").update({ photo_url: photoUrl } as any).eq("id", existing.id);
            return;
          }

          // No existing row — safe to insert
          const insertPayload = { rep_id: repId, customer_id: item.customer_id, visit_date: scheduleDate, ...checkoutData };
          const { data: visit, error: insertErr } = await supabase
            .from("visits")
            .insert(insertPayload as any)
            .select("id")
            .single();
          if (visit) {
            await supabase.from("schedule_items").update({ visit_id: visit.id }).eq("id", item.id);
            const photoUrl = await uploadPhotoOnline(visit.id, clientGenIdRef.current);
            if (photoUrl)
              await supabase.from("visits").update({ photo_url: photoUrl } as any).eq("id", visit.id);
          }
        }
      }
      // Only refresh the full schedule when the visit status changes to visited/skipped
      // For intermediate edits (arrival, notes, etc.), the local update is sufficient
      if (newItem.status === "visited" || newItem.status === "skipped") {
        onRefresh();
      }
    } catch (err: any) {
      console.warn("[Schedule] Network error on update:", err?.message);
      // Clear active card state even on network error to prevent stuck guard
      getActiveCard().then((card) => {
        if (card?.scheduleItemId === item.id) {
          clearActiveCard().catch(() => {});
        }
      }).catch(() => {});
      await queueScheduleItemUpdate(newItem);
      if (!activeVisitId) await handleOfflineVisitSave(newItem);
    } finally {
      setActionInProgress(false);
      if (newItem.status === "visited" || newItem.status === "skipped") {
        clearPendingPhoto(item.id).catch(() => {});
      }
      // Always clear active_card_state if this item was the active card,
      // even if the status update failed — prevents stuck visit guard
      getActiveCard().then((card) => {
        if (card?.scheduleItemId === item.id) {
          clearActiveCard().catch(() => {});
        }
      }).catch(() => {});
    }
  };

  const handleOfflineVisitSave = async (newItem: any) => {
    if (newItem.arrival_time && newItem.leaving_time && newItem.duration_minutes >= 0) {
      try {
        let photoB64: string | null = null;
        if (photoBlob) photoB64 = await blobToBase64(photoBlob);
        await saveVisitOffline(
          repId, item.customer_id, scheduleDate,
          newItem.arrival_time, newItem.leaving_time,
          newItem.duration_minutes, newItem.notes || null,
          item.customers?.customer_name, undefined, photoB64,
          newItem.order_number ?? null, newItem.order_quantity ?? null, newItem.order_amount ?? null,
        );
        toast.success("Saved offline. Will sync when online.");
      } catch (idbErr) {
        console.error("[Schedule] IndexedDB save failed:", idbErr);
        toast.error("Failed to save visit. Please try again.");
      }
    }
  };

  const saveDoneOrder = async () => {
    if (actionInProgress) return;
    setActionInProgress(true);
    try {
      let visitId = item.visit_id;
      if (!visitId) {
        const { data } = await supabase
          .from("visits")
          .select("id")
          .eq("rep_id", repId)
          .eq("customer_id", item.customer_id)
          .eq("visit_date", scheduleDate)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        visitId = data?.id;
      }
      if (!visitId) {
        toast.error("Visit record not found");
        setActionInProgress(false);
        return;
      }
      const { error } = await supabase.from("visits").update({
        order_number: doneOrderNumber || null,
        order_quantity: doneOrderQty !== "" ? Number(doneOrderQty) : null,
        order_amount: doneOrderAmount !== "" ? Number(doneOrderAmount) : null,
      } as any).eq("id", visitId);
      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Order updated");
        setEditingDone(false);
        onRefresh();
      }
    } catch {
      toast.error("Failed to update");
    } finally {
      setActionInProgress(false);
    }
  };

  const commitNotes   = () => { if (localNotes   !== (item.notes        || "")) updateItem({ notes:        localNotes   }); };
  const commitArrival = () => { if (localArrival !== (item.arrival_time || "")) updateItem({ arrival_time: localArrival }); };
  const commitLeaving = () => { if (localLeaving !== (item.leaving_time || "")) updateItem({ leaving_time: localLeaving }); };

  const markArrived = async () => {
    // Guard: block if another visit is already open
    const alreadyOpen = allItems.find(
      (i: any) => i.arrival_time && !i.leaving_time && i.id !== item.id
    );
    if (alreadyOpen) {
      toast.error(`You have an open visit at ${alreadyOpen.customers?.customer_name ?? "another customer"}. Please check out first.`);
      return;
    }

    // Guard: check IDB active card for a different item
    try {
      const card = await getActiveCard();
      if (card?.scheduleItemId && card.scheduleItemId !== item.id) {
        const openCardItem = allItems.find((i: any) => i.id === card.scheduleItemId);
        const isStale = !openCardItem
          || openCardItem.status === "visited"
          || openCardItem.status === "skipped"
          || !!openCardItem.leaving_time;

        if (isStale) {
          clearActiveCard().catch(() => {});
          // do NOT return — allow markArrived to proceed
        } else {
          const customerName = openCardItem?.customers?.customer_name ?? "another customer";
          toast.error(`You have an open visit at ${customerName}. Please check out first.`);
          return;
        }
      }
    } catch { /* IDB unavailable — skip check */ }

    const t = nowTime();
    setLocalArrival(t);
    // Always update schedule_items arrival_time (handles online/offline paths internally)
    updateItem({ arrival_time: t });

    if (navigator.onLine) {
      try {
        // Generate a stable client-side id for idempotent upsert — persists across retries
        if (!clientGenIdRef.current) clientGenIdRef.current = uuidv4();
        const cgid = clientGenIdRef.current;

        const { data, error } = await supabase
          .from("visits")
          .upsert(
            {
              rep_id: repId,
              customer_id: item.customer_id,
              visit_date: scheduleDate,
              arrival_time: t,
              status: "in_progress",
              client_generated_id: cgid,
            },
            { onConflict: "client_generated_id" }
          )
          .select("id")
          .single();

        if (!error && data?.id) {
          setActiveVisitId(data.id);

          // Upload photo if the rep had already captured one before tapping the clock
          if (photoBlob) {
            const photoUrl = await uploadPhotoOnline(data.id, cgid);
            if (photoUrl)
              await supabase.from("visits").update({ photo_url: photoUrl } as any).eq("id", data.id);
          }

          // Persist visitId in IDB so a background/resume cycle can restore it
          saveActiveCard({
            scheduleItemId: item.id,
            arrivalTime: t,
            notes: localNotes,
            visitId: data.id,
            clientGeneratedId: cgid,
          }).catch(() => {});
        } else {
          // Upsert failed (network or schema) — treat as offline, keep cgid for later
          saveActiveCard({
            scheduleItemId: item.id,
            arrivalTime: t,
            notes: localNotes,
            clientGeneratedId: cgid,
          }).catch(() => {});
        }
      } catch {
        // Network exception — fall through to offline path
        if (!clientGenIdRef.current) clientGenIdRef.current = uuidv4();
        saveActiveCard({
          scheduleItemId: item.id,
          arrivalTime: t,
          notes: localNotes,
          clientGeneratedId: clientGenIdRef.current,
        }).catch(() => {});
      }
    } else {
      // Offline path — store cgid so the sync engine can do an idempotent INSERT later
      if (!clientGenIdRef.current) clientGenIdRef.current = uuidv4();
      saveActiveCard({
        scheduleItemId: item.id,
        arrivalTime: t,
        notes: localNotes,
        clientGeneratedId: clientGenIdRef.current,
      }).catch(() => {});
    }
  };
  const markLeft    = () => { const t = nowTime(); setLocalLeaving(t); updateItem({ leaving_time: t, status: "visited", order_number: localOrderNumber || null, order_quantity: localOrderQty !== "" ? Number(localOrderQty) : null, order_amount: localOrderAmount !== "" ? Number(localOrderAmount) : null }); };

  const skipItem = async (note: string = skipNote) => {
    if (actionInProgress) return;
    if (!note.trim()) { toast.error("Please provide a reason before skipping"); return; }
    setActionInProgress(true);
    const skippedUpdates = { arrival_time: null, leaving_time: null, duration_minutes: 0, notes: note, status: "skipped" };
    onLocalUpdate(item.id, skippedUpdates);
    try {
      if (!navigator.onLine) {
        await queueScheduleItemUpdate(skippedUpdates);
        await saveVisitOffline(repId, item.customer_id, scheduleDate, "00:00", "00:00", 0, note, item.customers?.customer_name, "skipped");
        toast.success("Saved offline. Will sync when online.");
        return;
      }
      const { error } = await supabase.from("schedule_items").update({ status: "skipped", notes: note }).eq("id", item.id);
      if (error) {
        if (isOfflineError(error)) {
          await queueScheduleItemUpdate(skippedUpdates);
          await saveVisitOffline(repId, item.customer_id, scheduleDate, "00:00", "00:00", 0, note, item.customers?.customer_name, "skipped");
          toast.success("Saved offline. Will sync when online.");
          return;
        }
        toast.error(error.message); return;
      }
      await supabase.from("visits").insert({ rep_id: repId, customer_id: item.customer_id, visit_date: scheduleDate, arrival_time: "00:00", leaving_time: "00:00", duration_minutes: 0, notes: note, status: "skipped" } as any);
      onRefresh();
    } catch (err: any) {
      console.warn("[Schedule] Network error on skip:", err?.message);
      try {
        await queueScheduleItemUpdate(skippedUpdates);
        await saveVisitOffline(repId, item.customer_id, scheduleDate, "00:00", "00:00", 0, note, item.customers?.customer_name, "skipped");
        toast.success("Saved offline. Will sync when online.");
      } catch (idbErr) {
        console.error("[Schedule] IndexedDB save failed:", idbErr);
        toast.error("Failed to save. Please try again.");
      }
    } finally {
      setActionInProgress(false);
      setSkipMode(false);
      setSkipNote("");
      // Clear active card state in case rep arrived then chose to skip
      getActiveCard().then((card) => {
        if (card?.scheduleItemId === item.id) {
          clearActiveCard().catch(() => {});
        }
      }).catch(() => {});
    }
  };

  const markVisited = () => updateItem({ status: "visited", arrival_time: localArrival, leaving_time: localLeaving, notes: localNotes, order_number: localOrderNumber || null, order_quantity: localOrderQty !== "" ? Number(localOrderQty) : null, order_amount: localOrderAmount !== "" ? Number(localOrderAmount) : null });

  const isInProgress = item.status === "pending" && item.arrival_time && !item.leaving_time;
  const customerName = item.customers?.customer_name ?? "Unknown";
  const accountNum   = item.customers?.account_number;

  // ── collapsed row ──
  const collapsedRow = (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-4 px-5 py-4 text-left"
      style={{ background: "transparent", position: "relative" }}
    >
      {/* 42×42 avatar with number/icon */}
      <div
        className="shrink-0 rounded-[14px] flex items-center justify-center font-syne font-bold text-lg"
        style={{
          width: 42,
          height: 42,
          background: item.status === "visited" ? C.green :
                      item.status === "skipped" ? C.dangerSoft :
                      isInProgress ? C.greenDeep : C.cream,
          color: item.status === "visited" ? "#fff" :
                 item.status === "skipped" ? C.danger :
                 isInProgress ? C.sun : C.inkSoft,
          boxShadow: isInProgress ? `0 6px 14px -4px ${C.greenDeep}66` : "none",
        }}
      >
        {item.status === "visited" ? <Check size={18} /> :
         item.status === "skipped" ? <X size={16} /> :
         index + 1}
      </div>

      {/* name and details */}
      <div className="flex-1 min-w-0">
        <p className="font-syne font-600 text-base" style={{ color: C.ink, letterSpacing: "-0.2px", lineHeight: 1.1 }}>{customerName}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <StatusPill status={item.status} isInProgress={!!isInProgress} />
          <span className="text-[11px]" style={{ color: C.inkMute, fontFamily: "'DM Sans', sans-serif" }}>· {accountNum || "—"}</span>
          {item.status === "visited" && item.duration_minutes > 0 && (
            <span className="text-[11px] font-semibold inline-flex items-center gap-1" style={{ color: C.inkSoft, fontFamily: "'DM Sans', sans-serif" }}>
              · <Clock size={11} /> {item.duration_minutes}m
            </span>
          )}
          {item.status === "visited" && item.order && (
            <span className="text-[11px]" style={{ color: C.inkMute, fontFamily: "'DM Sans', sans-serif" }}>· R {parseFloat(String(item.order.order_amount || 0)).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          )}
        </div>
      </div>

      {/* expand chevron */}
      <span style={{ color: C.inkMute, transform: isExpanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 320ms cubic-bezier(0.22,0.61,0.36,1)" }}>
        <ChevronDown size={18} />
      </span>
    </button>
  );

  return (
    <div
      id={`card-${item.id}`}
      className="rounded-[22px] overflow-hidden"
      style={{
        background: isInProgress ? `linear-gradient(180deg, ${C.surface} 0%, ${C.surfaceAlt} 100%)` : C.surface,
        border: `${isInProgress && isExpanded ? 1.5 : 1}px solid ${isInProgress && isExpanded ? C.green : C.border}`,
        boxShadow: isInProgress
          ? `0 14px 30px -14px rgba(27,82,56,0.32), 0 1px 0 rgba(255,255,255,0.6) inset`
          : "0 1px 0 rgba(255,255,255,0.7) inset, 0 1px 2px rgba(23,23,21,0.04)",
        transition: "border-color 280ms ease, box-shadow 280ms ease",
        position: "relative",
      }}
    >
      {collapsedRow}

      <Expand open={isExpanded}>
        <div style={{ height: 1, background: `linear-gradient(90deg, transparent, ${C.border}, transparent)`, margin: "0" }} />

      <div className="px-[18px] pb-5" style={{ paddingTop: "14px" }}>
        {/* visited state */}
        {item.status === "visited" && (
          <>
            {/* Time at stop & Order cards (2-col grid) */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
              <div
                style={{
                  background: C.surfaceAlt,
                  borderRadius: 16,
                  padding: "12px 14px",
                  position: "relative",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 10.5, color: C.inkMute, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 700, fontFamily: "'DM Sans', sans-serif", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Clock size={13} />Time at stop
                  </div>
                  <Lock size={11} color={C.inkMute} />
                </div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, color: C.ink, fontWeight: 700, letterSpacing: "-0.4px", marginTop: 4, lineHeight: 1 }}>
                  {item.duration_minutes > 0 ? (item.duration_minutes < 60 ? `${item.duration_minutes}m` : `${Math.floor(item.duration_minutes / 60)}h ${item.duration_minutes % 60}m`) : "—"}
                </div>
                {item.arrival_time && item.leaving_time && (
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11.5, color: C.inkSoft, marginTop: 4 }}>
                    {item.arrival_time.slice(0, 5)} → {item.leaving_time.slice(0, 5)}
                  </div>
                )}
              </div>

              {item.order && (
                <div
                  style={{
                    background: C.surfaceAlt,
                    borderRadius: 16,
                    padding: "12px 14px",
                  }}
                >
                  <div style={{ fontSize: 10.5, color: C.inkMute, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}>
                    Order {item.order.order_number}
                  </div>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, color: C.ink, fontWeight: 700, letterSpacing: "-0.4px", marginTop: 4, lineHeight: 1 }}>
                    R {parseFloat(String(item.order.order_amount || 0)).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11.5, color: C.inkSoft, marginTop: 4 }}>
                    {item.order.order_quantity} units
                  </div>
                </div>
              )}
            </div>

            {/* Edit Order button or form */}
            {!editingDone && (
              <button
                type="button"
                onClick={async () => {
                  let visitId = item.visit_id;
                  let visitData: any = null;
                  if (visitId) {
                    const res = await supabase.from("visits").select("order_number, order_quantity, order_amount").eq("id", visitId).maybeSingle();
                    visitData = res.data;
                  }
                  if (!visitData) {
                    const res = await (supabase.from("visits").select("order_number, order_quantity, order_amount")
                      .eq("rep_id", repId).eq("customer_id", item.customer_id).eq("visit_date", scheduleDate)
                      .order("created_at", { ascending: false }).limit(1).maybeSingle() as any);
                    visitData = res.data;
                  }
                  setDoneOrderNumber(visitData?.order_number || "");
                  setDoneOrderQty(visitData?.order_quantity != null ? String(visitData.order_quantity) : "");
                  setDoneOrderAmount(visitData?.order_amount != null ? String(visitData.order_amount) : "");
                  setEditingDone(true);
                }}
                style={{
                  width: "100%",
                  height: 38,
                  borderRadius: 12,
                  border: `1px solid ${C.border}`,
                  background: C.surface,
                  color: C.inkSoft,
                  cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 600,
                  fontSize: 12.5,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                <Pencil size={13} /> Edit order details
              </button>
            )}

            {editingDone && (
              <div style={{ background: C.cream, borderRadius: 16, padding: 12, marginBottom: 10, border: `1px solid ${C.border}` }}>
                <Expand open={editingDone}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 10.5, color: C.inkMute, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}>
                      Edit order
                    </div>
                    <div style={{ fontSize: 10, color: C.inkMute, fontFamily: "'DM Sans', sans-serif", display: "inline-flex", alignItems: "center", gap: 3 }}>
                      <Lock size={10} /> Times &amp; locked
                    </div>
                  </div>
                <div style={{ display: "grid", gridTemplateColumns: "1.3fr 0.6fr 1fr", gap: 8, marginBottom: 10 }}>
                  {/* PadInput-style inputs */}
                  <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                    <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>№</div>
                    <input
                      type="text"
                      value={doneOrderNumber}
                      onChange={(e) => setDoneOrderNumber(e.target.value)}
                      onBlur={resetMobileZoom}
                      placeholder="PO-0000"
                      style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }}
                    />
                  </label>
                  <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                    <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>Qty</div>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={doneOrderQty}
                      onChange={(e) => setDoneOrderQty(e.target.value)}
                      onBlur={resetMobileZoom}
                      placeholder="0"
                      style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }}
                    />
                  </label>
                  <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                    <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>Value</div>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={doneOrderAmount}
                      onChange={(e) => setDoneOrderAmount(e.target.value)}
                      onBlur={resetMobileZoom}
                      placeholder="R 0,00"
                      style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }}
                    />
                  </label>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setEditingDone(false)}
                    style={{
                      height: 40,
                      borderRadius: 12,
                      border: "none",
                      cursor: "pointer",
                      background: "transparent",
                      color: C.inkSoft,
                      fontFamily: "'DM Sans', sans-serif",
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={saveDoneOrder}
                    disabled={actionInProgress}
                    style={{
                      height: 40,
                      borderRadius: 12,
                      border: "none",
                      cursor: "pointer",
                      background: `linear-gradient(180deg, ${C.greenMid} 0%, ${C.green} 100%)`,
                      color: "#fff",
                      fontFamily: "'Syne', sans-serif",
                      fontWeight: 700,
                      fontSize: 13,
                      letterSpacing: 0.2,
                      boxShadow: `0 8px 16px -8px ${C.green}aa, 0 1px 0 rgba(255,255,255,0.2) inset`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    <Check size={14} /> Save changes
                  </button>
                </div>
                </Expand>
              </div>
            )}
          </>
        )}

        {/* skipped state */}
        {item.status === "skipped" && item.notes && (
          <div style={{ background: C.dangerSoft, borderRadius: 16, padding: 14, marginBottom: 6, border: `1px solid ${C.danger}22` }}>
            <div style={{ fontSize: 10.5, color: C.danger, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 700, fontFamily: "'DM Sans', sans-serif", marginBottom: 4 }}>
              Skip reason
            </div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: C.ink, lineHeight: 1.45 }}>
              {item.notes}
            </div>
          </div>
        )}

        {/* pending / active state */}
        {item.status === "pending" && !skipMode && (
          <>
            {/* Stepper pills */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px", background: C.cream, borderRadius: 999, marginBottom: 14 }}>
              <div style={{ flex: 1, textAlign: "center", padding: "7px 4px", borderRadius: 999, background: localArrival ? C.surface : "transparent", boxShadow: localArrival ? "0 2px 6px rgba(23,23,21,0.06)" : "none" }}>
                <div style={{ fontSize: 9.5, color: C.inkMute, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif", fontWeight: 700 }}>Arrived</div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: localArrival ? C.greenInk : C.inkMute, marginTop: 1, fontWeight: 600 }}>
                  {localArrival || "—"}
                </div>
              </div>
              <div style={{ flex: 1, textAlign: "center", padding: "7px 4px", borderRadius: 999, background: photoBlob ? C.surface : "transparent", boxShadow: photoBlob ? "0 2px 6px rgba(23,23,21,0.06)" : "none" }}>
                <div style={{ fontSize: 9.5, color: C.inkMute, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif", fontWeight: 700 }}>Photo</div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: photoBlob ? C.greenInk : C.inkMute, marginTop: 1, fontWeight: 600 }}>
                  {photoBlob ? "✓" : "—"}
                </div>
              </div>
              <div style={{ flex: 1, textAlign: "center", padding: "7px 4px", borderRadius: 999, background: "transparent" }}>
                <div style={{ fontSize: 9.5, color: C.inkMute, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif", fontWeight: 700 }}>Order</div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: C.inkMute, marginTop: 1, fontWeight: 600 }}>
                  —
                </div>
              </div>
              <div style={{ flex: 1, textAlign: "center", padding: "7px 4px", borderRadius: 999, background: "transparent" }}>
                <div style={{ fontSize: 9.5, color: C.inkMute, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif", fontWeight: 700 }}>Left</div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: C.inkMute, marginTop: 1, fontWeight: 600 }}>
                  —
                </div>
              </div>
            </div>

            {!isInProgress ? (
              /* Pending state — show arrive button */
              <>
                <button
                  type="button"
                  onClick={markArrived}
                  style={{
                    width: "100%",
                    height: 56,
                    borderRadius: 18,
                    border: "none",
                    cursor: "pointer",
                    background: `linear-gradient(180deg, ${C.greenMid} 0%, ${C.green} 100%)`,
                    color: "#fff",
                    fontFamily: "'Syne', sans-serif",
                    fontWeight: 700,
                    fontSize: 16,
                    letterSpacing: 0.2,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    boxShadow: `0 12px 24px -10px ${C.green}88`,
                    marginBottom: 6,
                  }}
                >
                  <MapPin size={18} /> Tap to check in
                </button>
                <button
                  type="button"
                  onClick={() => { setSkipMode(true); setSkipNote(""); }}
                  style={{
                    width: "100%",
                    height: 40,
                    borderRadius: 12,
                    border: "none",
                    cursor: "pointer",
                    background: "transparent",
                    color: C.inkSoft,
                    fontFamily: "'DM Sans', sans-serif",
                    fontWeight: 600,
                    fontSize: 13,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                  }}
                >
                  <SkipForward size={14} /> Mark as skipped
                </button>
              </>
            ) : (
              /* Active state — show order, photo, checkout */
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                  <button
                    type="button"
                    onClick={handleCameraCapture}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      height: 44,
                      borderRadius: 14,
                      cursor: "pointer",
                      background: photoBlob ? C.greenInk : C.cream,
                      color: photoBlob ? "#fff" : C.inkSoft,
                      border: "none",
                      fontFamily: "'DM Sans', sans-serif",
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    <Camera size={15} /> {photoBlob ? "Photo ready" : "Take photo"}
                  </button>
                  <button
                    type="button"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      height: 44,
                      borderRadius: 14,
                      cursor: "pointer",
                      background: C.cream,
                      color: C.inkSoft,
                      border: "none",
                      fontFamily: "'DM Sans', sans-serif",
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    <FileText size={15} /> Add note
                  </button>
                </div>

                <div style={{ background: C.cream, borderRadius: 16, padding: 12, marginBottom: 14 }}>
                  <div style={{ fontSize: 10.5, color: C.inkMute, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 600, fontFamily: "'DM Sans', sans-serif", marginBottom: 8 }}>
                    Order
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1.3fr 0.6fr 1fr", gap: 8 }}>
                    <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                      <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>№</div>
                      <input type="text" value={localOrderNumber} onChange={(e) => setLocalOrderNumber(e.target.value)} onBlur={resetMobileZoom} placeholder="PO-0000" style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }} />
                    </label>
                    <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                      <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>Qty</div>
                      <input type="number" min="0" step="1" value={localOrderQty} onChange={(e) => setLocalOrderQty(e.target.value)} onBlur={resetMobileZoom} placeholder="0" style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }} />
                    </label>
                    <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                      <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>Value</div>
                      <input type="number" min="0" step="0.01" value={localOrderAmount} onChange={(e) => setLocalOrderAmount(e.target.value)} onBlur={resetMobileZoom} placeholder="R 0,00" style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }} />
                    </label>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={markLeft}
                  style={{
                    width: "100%",
                    height: 60,
                    borderRadius: 18,
                    border: "none",
                    cursor: "pointer",
                    background: `linear-gradient(180deg, ${C.greenMid} 0%, ${C.green} 100%)`,
                    color: "#fff",
                    fontFamily: "'Syne', sans-serif",
                    fontWeight: 700,
                    fontSize: 17,
                    letterSpacing: 0.3,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    boxShadow: `0 12px 28px -10px ${C.green}aa, 0 1px 0 rgba(255,255,255,0.2) inset, 0 -1px 0 ${C.greenDeep}88 inset`,
                    marginBottom: 6,
                  }}
                >
                  <Check size={20} /> Tap to check out
                </button>
                <button
                  type="button"
                  onClick={() => { setSkipMode(true); setSkipNote(""); }}
                  style={{
                    width: "100%",
                    height: 40,
                    borderRadius: 12,
                    border: "none",
                    cursor: "pointer",
                    background: "transparent",
                    color: C.inkSoft,
                    fontFamily: "'DM Sans', sans-serif",
                    fontWeight: 600,
                    fontSize: 13,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                  }}
                >
                  <SkipForward size={14} /> Mark as skipped
                </button>
              </>
            )}
          </>
        )}

        {/* Skip composer — shows when skipMode = true */}
        {item.status === "pending" && skipMode && (
          <div style={{ background: `linear-gradient(180deg, ${C.dangerSoft} 0%, #FBEFE9 100%)`, borderRadius: 18, padding: 14, border: `1px solid ${C.danger}33` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: 10, background: C.danger, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <SkipForward size={14} />
                </div>
                <div>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, letterSpacing: "-0.1px" }}>Skip this stop</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: C.inkSoft }}>A note is required.</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setSkipMode(false); setSkipNote(""); }}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.6)",
                  border: "none",
                  color: C.inkSoft,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={14} />
              </button>
            </div>

            <div style={{ background: "#fff", borderRadius: 14, padding: 12, border: `1px solid ${C.danger}22`, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)", marginBottom: 12 }}>
              <textarea
                value={skipNote}
                onChange={(e) => setSkipNote(e.target.value.slice(0, 240))}
                placeholder="Why are you skipping this stop?"
                rows={3}
                style={{
                  width: "100%",
                  resize: "none",
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 13.5,
                  color: C.ink,
                  lineHeight: 1.45,
                }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                <div style={{ fontSize: 10.5, color: C.inkMute, fontFamily: "'DM Sans', sans-serif", letterSpacing: 0.8, textTransform: "uppercase", fontWeight: 600 }}>
                  {skipNote.trim().length >= 3 ? "Looks good" : "Required"}
                </div>
                <div style={{ fontSize: 11, color: C.inkMute, fontFamily: "'DM Sans', sans-serif" }}>
                  {skipNote.length}/240
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => skipItem(skipNote)}
              disabled={skipNote.trim().length < 3 || actionInProgress}
              style={{
                width: "100%",
                height: 52,
                borderRadius: 16,
                border: "none",
                cursor: skipNote.trim().length >= 3 ? "pointer" : "not-allowed",
                marginTop: 0,
                background: skipNote.trim().length >= 3 ? `linear-gradient(180deg, #C46A57 0%, ${C.danger} 100%)` : "rgba(184,90,74,0.25)",
                color: "#fff",
                fontFamily: "'Syne', sans-serif",
                fontWeight: 700,
                fontSize: 15,
                letterSpacing: 0.2,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                boxShadow: skipNote.trim().length >= 3 ? `0 10px 22px -10px ${C.danger}aa, 0 1px 0 rgba(255,255,255,0.15) inset` : "none",
                opacity: skipNote.trim().length >= 3 ? 1 : 0.85,
                transition: "background 200ms, box-shadow 200ms",
              }}
            >
              <SkipForward size={16} /> Confirm skip
            </button>
          </div>
        )}
        </div>
      </Expand>
    </div>
  );
}

// ─── DailySchedule ────────────────────────────────────────────────────────────

export default function DailySchedule() {
  const { repId, signOut } = useAuth();
  if (!repId) return null;
  const navigate  = useNavigate();
  const location  = useLocation();

  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().split("T")[0]);
  const [schedule,     setSchedule]     = useState<any>(null);
  const [items,        setItems]        = useState<any[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [generating,   setGenerating]   = useState(false);
  const [currentWeekName, setCurrentWeekName] = useState<string>("");
  const [isOnline,     setIsOnline]     = useState(navigator.onLine);

  // end-of-day summary
  const [showSummary,      setShowSummary]      = useState(false);
  const [summaryStats,     setSummaryStats]     = useState<SummaryStats | null>(null);
  const [summaryDismissed, setSummaryDismissed] = useState(false);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);

  // accordion state
  const [expandedActiveId,    setExpandedActiveId]    = useState<string | null>(null);
  const expandedActiveIdRef = useRef<string | null>(null);
  const itemsRef            = useRef<any[]>([]);
  const [openCompletedId,     setOpenCompletedId]     = useState<string | null>(null);
  const [activeTab,           setActiveTab]           = useState<"active" | "done">("active");

  // unscheduled visits (Done tab)
  const [unscheduledVisits,           setUnscheduledVisits]           = useState<any[]>([]);
  const [unscheduledEditingId,        setUnscheduledEditingId]        = useState<string | null>(null);
  const [unscheduledOrderNumber,      setUnscheduledOrderNumber]      = useState("");
  const [unscheduledOrderQty,         setUnscheduledOrderQty]         = useState("");
  const [unscheduledOrderAmount,      setUnscheduledOrderAmount]      = useState("");
  const [unscheduledActionInProgress, setUnscheduledActionInProgress] = useState(false);

  // in-progress visit recovery banner
  const [recoveryItemId,       setRecoveryItemId]       = useState<string | null>(null);
  const [recoveryCustomerName, setRecoveryCustomerName] = useState<string | null>(null);

  // stale-template self-heal — tracks the last schedule.id that was validated so it only runs once per schedule
  const validationRanRef   = useRef<string | null>(null);
  // Stable refs so visibility/online handlers always read the latest values without recreating
  const scheduleDateRef    = useRef(scheduleDate);
  const fetchScheduleRef   = useRef<() => Promise<void>>(async () => {});

  // bottom card expansion — mutually exclusive: "unscheduled" | "offroute" | null
  const [expandedBottomCard, setExpandedBottomCard] = useState<"unscheduled" | "offroute" | null>(null);

  // ad-hoc visit state
  const [adHocCustomers,   setAdHocCustomers]   = useState<any[]>([]);
  const [adHocCustomerId,  setAdHocCustomerId]  = useState("");
  const [adHocArrival,     setAdHocArrival]     = useState("");
  const [adHocLeaving,     setAdHocLeaving]     = useState("");
  const [adHocNotes,       setAdHocNotes]       = useState("");
  const [adHocOrderNumber, setAdHocOrderNumber] = useState("");
  const [adHocOrderQty,    setAdHocOrderQty]    = useState("");
  const [adHocOrderAmount, setAdHocOrderAmount] = useState("");
  const [adHocSubmitting,  setAdHocSubmitting]  = useState(false);
  const [adHocPhoto, setAdHocPhoto] = useState<{ blob: Blob; preview: string } | null>(null);

  // off-route order state
  const [offRouteCustomerId,  setOffRouteCustomerId]  = useState("");
  const [offRouteOrderNumber, setOffRouteOrderNumber] = useState("");
  const [offRouteOrderQty,    setOffRouteOrderQty]    = useState("");
  const [offRouteOrderAmount, setOffRouteOrderAmount] = useState("");
  const [offRouteNotes,       setOffRouteNotes]       = useState("");
  const [offRouteSubmitting,  setOffRouteSubmitting]  = useState(false);

  // online/offline listener
  useEffect(() => {
    const onOnline  = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online",  onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, []);

  // pending photo retry handler
  useEffect(() => {
    const retryPendingPhotos = async () => {
      try {
        const pending = await getAllPendingPhotos();
        for (const p of pending) {
          try {
            const base64 = p.base64;
            const byteString = atob(base64.split(",")[1] ?? base64);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
            const blob = new Blob([ab], { type: "image/jpeg" });

            const fileName = `${p.clientGeneratedId || p.scheduleItemId}.jpg`;
            const { error } = await supabase.storage
              .from("visit-photos")
              .upload(fileName, blob, { upsert: true });
            if (error) continue;

            const { data: urlData } = supabase.storage.from("visit-photos").getPublicUrl(fileName);
            const publicUrl = urlData?.publicUrl;
            if (!publicUrl) continue;

            if (p.visitId) {
              await supabase.from("visits").update({ photo_url: publicUrl }).eq("id", p.visitId);
            } else if (p.clientGeneratedId) {
              await supabase.from("visits").update({ photo_url: publicUrl }).eq("client_generated_id", p.clientGeneratedId);
            }

            await clearPendingPhoto(p.scheduleItemId);
          } catch { /* leave this photo in the queue, try next */ }
        }
      } catch { /* never throw, never block UI */ }
    };

    const onOnlineRetry = () => retryPendingPhotos();
    const onVisibilityRetry = () => { if (document.visibilityState === "visible") retryPendingPhotos(); };

    window.addEventListener("online", onOnlineRetry);
    document.addEventListener("visibilitychange", onVisibilityRetry);
    return () => {
      window.removeEventListener("online", onOnlineRetry);
      document.removeEventListener("visibilitychange", onVisibilityRetry);
    };
  }, []);

  // derived item lists
  const activeItems    = items.filter((i) => i.status !== "visited" && i.status !== "skipped");
  const completedItems = items.filter((i) => i.status === "visited" || i.status === "skipped");

  const visitedCount = items.filter((i) => i.status === "visited").length;
  const totalCount   = items.length;
  const progress     = totalCount > 0 ? visitedCount / totalCount : 0;

  // auto-expand first in-progress, then first pending
  useEffect(() => {
    if (expandedActiveId) return; // already expanded something
    const inProgressItem = activeItems.find((i) => i.arrival_time && !i.leaving_time);
    const upNextItem     = activeItems.find((i) => !i.arrival_time);
    const target = inProgressItem ?? upNextItem ?? null;
    setExpandedActiveId(target?.id ?? null);
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep refs in sync so realtime callbacks can read current values without stale closures
  useEffect(() => {
    expandedActiveIdRef.current = expandedActiveId;
  }, [expandedActiveId]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // ─── data (preserved verbatim) ─────────────────────────────────────────────

  const handleLocalUpdate = useCallback(
    (itemId: string, updates: any) => {
      setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, ...updates } : it)));
      if (repId) {
        updateCachedScheduleItem(repId, scheduleDate, itemId, updates).catch((err) =>
          console.warn("[Schedule] Failed to persist local schedule update:", err)
        );
      }
    },
    [repId, scheduleDate]
  );

  const autoGenerateSchedule = useCallback(async () => {
    if (!repId) return null;
    try {
      const { data, error } = await supabase.rpc("auto_generate_daily_schedule", {
        p_rep_id: repId,
        p_schedule_date: scheduleDate,
      });
      if (error) { console.error("Auto-generate error:", error.message); return null; }
      return data as string | null;
    } catch (err) {
      console.warn("[Schedule] Offline, cannot auto-generate schedule");
      return null;
    }
  }, [repId, scheduleDate]);

  const fetchWeekName = async () => {
    setCurrentWeekName(""); // clear stale label immediately before the async lookup
    try {
      const { data: weekOrder } = await (supabase.rpc as any)("get_week_order_for_date", { p_date: scheduleDate });
      if (weekOrder) {
        const { data: wk } = await supabase
          .from("weekly_templates")
          .select("name")
          .eq("sort_order", weekOrder)
          .maybeSingle();
        if (wk) setCurrentWeekName(wk.name);
      }
    } catch { /* offline - ignore */ }
  };

  useEffect(() => {
    if (repId) { fetchSchedule(); fetchAdHocCustomers(); fetchWeekName(); }
  }, [repId, scheduleDate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!schedule?.id) return;
    const channel = supabase
      .channel(`schedule-items-${schedule.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "schedule_items", filter: `schedule_id=eq.${schedule.id}` }, () => {
        // Don't refresh if the user is actively editing a card (has one expanded in Active tab)
        // This prevents losing local state like captured photos
        // The schedule will refresh when they complete/skip the visit
        if (!expandedActiveIdRef.current) {
          fetchSchedule();
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [schedule?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!repId) return;
    const channel = supabase
      .channel(`daily-schedules-${repId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_schedules", filter: `rep_id=eq.${repId}` }, () => {
        if (!expandedActiveIdRef.current) {
          fetchSchedule();
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [repId, scheduleDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime subscription for visits table — refreshes unscheduled visits on INSERT/UPDATE.
  // Uses the same expandedActiveIdRef guard as the other subscriptions.
  useEffect(() => {
    if (!repId) return;
    const channel = supabase
      .channel(`visits-unscheduled-${repId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "visits", filter: `rep_id=eq.${repId}` }, () => {
        if (!expandedActiveIdRef.current) {
          fetchUnscheduledVisits();
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [repId, scheduleDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const resolveUnknownCustomers = async (loadedItems: any[]) => {
    const unresolved = loadedItems.filter((i) => !i.customers?.customer_name);
    if (!unresolved.length) return;
    const ids = [...new Set(unresolved.map((i: any) => i.customer_id).filter(Boolean))];
    if (!ids.length) return;
    try {
      const { data } = await supabase.from("customers").select("*").in("id", ids);
      if (!data?.length) return;
      const byId = Object.fromEntries(data.map((c: any) => [c.id, c]));
      setItems((prev) =>
        prev.map((i) => (!i.customers?.customer_name && byId[i.customer_id] ? { ...i, customers: byId[i.customer_id] } : i))
      );
    } catch {
      // silently ignore — items remain in state, rendering falls through to existing fallback
    }
  };

  const validateScheduleItemCustomers = async (scheduleItems: any[]) => {
    try {
      // Build array of resolved customers from items
      const customers = [
        ...new Map(
          (scheduleItems || [])
            .map((i: any) => i.customers)
            .filter((c: any) => c)
            .map((c: any) => [c.id, c])
        ).values(),
      ];

      // Find customer_ids that aren't resolved
      const unresolvedIds = (scheduleItems ?? [])
        .map((si: any) => si.customer_id)
        .filter((id: string) => {
          const found = customers.find((c: any) => c.id === id);
          return !found;
        });

      if (unresolvedIds.length > 0) {
        const { data: missingCustomers } = await supabase
          .from("customers")
          .select("*")
          .in("id", unresolvedIds);

        if (missingCustomers && missingCustomers.length > 0) {
          const byId = Object.fromEntries(missingCustomers.map((c: any) => [c.id, c]));
          setItems((prev: any[]) =>
            prev.map((i) => (!i.customers && byId[i.customer_id] ? { ...i, customers: byId[i.customer_id] } : i))
          );
        }
      }
    } catch {
      // silently ignore — items remain in state
    }
  };

  const fetchSchedule = async () => {
    if (!repId) return;
    setLoading(true);
    let hasCachedSchedule = false;

    try {
      const cached = await getCachedSchedule(repId, scheduleDate);
      if (cached) {
        hasCachedSchedule = true;
        setSchedule(cached);
        setItems((cached.schedule_items || []).sort((a: any, b: any) => a.sort_order - b.sort_order));
        setLoading(false);
      }
    } catch (cacheErr) {
      console.warn("[Schedule] Failed to read cached schedule:", cacheErr);
    }

    if (!navigator.onLine) {
      if (!hasCachedSchedule) { setSchedule(null); setItems([]); setLoading(false); }
      return;
    }

    try {
      const { data } = await supabase
        .from("daily_schedules")
        .select("*, schedule_items(*, customers(customer_name, account_number))")
        .eq("rep_id", repId)
        .eq("schedule_date", scheduleDate)
        .maybeSingle();

      if (data) {
        setSchedule(data);
        const sortedItems = (data.schedule_items || []).sort((a: any, b: any) => a.sort_order - b.sort_order);
        setItems(sortedItems);
        resolveUnknownCustomers(sortedItems);
        validateScheduleItemCustomers(sortedItems);
        await setCachedSchedule(repId, scheduleDate, data);
      } else {
        // Only auto-generate for today or past dates — never pre-generate future schedules
        const todayStr = new Date().toISOString().split("T")[0];
        if (scheduleDate <= todayStr) {
          setGenerating(true);
          const newId = await autoGenerateSchedule();
          setGenerating(false);
          if (newId) {
            const { data: newData } = await supabase
              .from("daily_schedules")
              .select("*, schedule_items(*, customers(customer_name, account_number))")
              .eq("id", newId)
              .maybeSingle();
            setSchedule(newData);
            const sortedNewItems = (newData?.schedule_items || []).sort((a: any, b: any) => a.sort_order - b.sort_order);
            setItems(sortedNewItems);
            resolveUnknownCustomers(sortedNewItems);
            validateScheduleItemCustomers(sortedNewItems);
            if (newData) await setCachedSchedule(repId, scheduleDate, newData);
          } else {
            setSchedule(null); setItems([]);
          }
        } else {
          // Future date with no existing schedule — leave it ungenerated
          setSchedule(null); setItems([]);
        }
      }
      if (isToday) repairMissingVisitIds();
      if (isToday) {
        try {
          const today = new Date().toISOString().split("T")[0];
          const { data: weekOrder } = await supabase
            .rpc("get_week_order_for_date", { p_date: today });
          const { data: setting } = await supabase
            .from("app_settings")
            .select("setting_value")
            .eq("setting_key", "current_week_order")
            .maybeSingle();
          const storedOrder = setting ? parseInt(setting.setting_value) || 1 : 1;
          if (weekOrder !== null && weekOrder !== undefined && weekOrder !== storedOrder) {
            await supabase.from("app_settings").upsert({
              setting_key: "current_week_order",
              setting_value: String(weekOrder),
              updated_at: new Date().toISOString(),
            }, { onConflict: "setting_key" });
          }
        } catch (healErr) {
          console.warn("[Schedule] Week order self-heal failed:", healErr);
        }
      }
    } catch (err) {
      console.warn("[Schedule] Online refresh failed, keeping cached schedule if available", err);
      if (!hasCachedSchedule) { setSchedule(null); setItems([]); }
    } finally {
      setLoading(false);
    }
  };

  fetchScheduleRef.current = fetchSchedule;

  // ─── unscheduled visits ───────────────────────────────────────────────────
  // Fetches visits for this rep/date that are NOT linked to any schedule_item.
  // Uses itemsRef (not items) so the function stays stable for repId/scheduleDate
  // and can safely be called from the realtime subscription without stale closure.
  const fetchUnscheduledVisits = useCallback(async () => {
    if (!repId) return;
    try {
      const linkedVisitIds = itemsRef.current
        .map((i: any) => i.visit_id)
        .filter(Boolean) as string[];

      let query = supabase
        .from("visits")
        .select("*, customers(customer_name)")
        .eq("rep_id", repId)
        .eq("visit_date", scheduleDate)
        .neq("status", "in_progress");

      if (linkedVisitIds.length > 0) {
        query = (query as any).not("id", "in", `(${linkedVisitIds.join(",")})`);
      }

      const { data } = await query;
      const scheduledCustomerIds = new Set(
        itemsRef.current
          .filter((i: any) => i.status === "visited" || i.status === "skipped")
          .map((i: any) => i.customer_id)
      );
      const trueUnscheduled = (data ?? []).filter(
        (v: any) => !scheduledCustomerIds.has(v.customer_id)
      );
      setUnscheduledVisits(trueUnscheduled);
    } catch {
      // network error — keep existing state
    }
  }, [repId, scheduleDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch unscheduled visits whenever scheduled items change (a new visit_id may appear)
  useEffect(() => {
    fetchUnscheduledVisits();
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  // Silent background repair: stamps visit_id back onto schedule_items that missed it
  // due to network failures. Uses itemsRef so it doesn't need a stable closure dependency.
  const repairMissingVisitIds = async () => {
    try {
      if (!repId) return;
      const unlinked = itemsRef.current.filter(
        (i: any) => (i.status === "visited" || i.status === "skipped") && !i.visit_id
      );
      if (!unlinked.length) { fetchUnscheduledVisits(); return; }
      for (const si of unlinked) {
        try {
          const { data: visit } = await supabase
            .from("visits")
            .select("id")
            .eq("rep_id", repId)
            .eq("customer_id", si.customer_id)
            .eq("visit_date", scheduleDate)
            .eq("status", "visited")
            .maybeSingle();
          if (visit?.id) {
            await supabase
              .from("schedule_items")
              .update({ visit_id: visit.id })
              .eq("id", si.id);
          }
        } catch { /* per-item failure is non-fatal */ }
      }
      fetchUnscheduledVisits();
    } catch { /* never throw, never block UI */ }
  };

  // ─── stale template self-heal ──────────────────────────────────────────────
  // Runs once per schedule row after the initial fetch. Detects a weekly_template_id
  // mismatch (possible after a rotation anchor change) and silently regenerates the
  // daily schedule — but only when no visits have been started yet.
  useEffect(() => {
    if (!schedule?.id || !repId || !isToday) return;
    if (validationRanRef.current === schedule.id) return;
    validationRanRef.current = schedule.id;

    (async () => {
      try {
        // Step 1: correct week order for today
        const { data: weekOrder, error: weekOrderErr } = await (supabase.rpc as any)(
          "get_week_order_for_date",
          { p_date: scheduleDate }
        );
        if (weekOrderErr || weekOrder == null) return;

        // Step 2: canonical weekly_template id for that week order
        const { data: tpl, error: tplErr } = await supabase
          .from("weekly_templates")
          .select("id")
          .eq("sort_order", weekOrder)
          .maybeSingle();
        if (tplErr || !tpl) return;

        // Step 3: compare — if already correct, nothing to do
        if (schedule.weekly_template_id === tpl.id) return;

        // Step 4: check whether any items have started
        const { count, error: countErr } = await supabase
          .from("schedule_items")
          .select("id", { count: "exact", head: true })
          .eq("schedule_id", schedule.id)
          .or("arrival_time.not.is.null,status.in.(visited,skipped)");
        if (countErr) return;
        if ((count ?? 0) > 0) return; // visits in progress — leave it alone

        // Step 5: delete the stale row (cascade removes its schedule_items)
        const { error: delErr } = await supabase
          .from("daily_schedules")
          .delete()
          .eq("id", schedule.id);
        if (delErr) return;

        // Step 6: regenerate from the correct template
        const { error: genErr } = await supabase.rpc("auto_generate_daily_schedule", {
          p_rep_id: repId,
          p_schedule_date: scheduleDate,
        });
        if (genErr) return;

        // Step 7: refresh so the UI shows the new items
        validationRanRef.current = null;
        fetchSchedule();
      } catch {
        // Offline or unexpected error — fail silently, never surface to the rep
      }
    })();
  }, [schedule?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset validation ref when the rep navigates to a different date
  useEffect(() => {
    scheduleDateRef.current = scheduleDate;
    validationRanRef.current = null;
  }, [scheduleDate]);

  // Week-boundary detection on app resume — catches overnight / cross-weekend opens
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") {
        const todayStr = new Date().toISOString().split("T")[0];
        if (scheduleDateRef.current !== todayStr) {
          validationRanRef.current = null;
          fetchScheduleRef.current();
        }
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchAdHocCustomers = async () => {
    if (!repId) return;
    const loadFromCache = async () => {
      try {
        const cached = await getCachedCustomers();
        if (cached.length > 0) {
          setAdHocCustomers(
            cached.map((c) => ({ id: c.id, customer_name: c.customer_name, account_number: c.account_number, area: c.area, is_active: true }))
          );
        }
      } catch { /* keep existing state */ }
    };
    await loadFromCache();
    if (!navigator.onLine) return;
    try {
      const { data } = await supabase
        .from("customer_assignments")
        .select("customer_id, customers(id, customer_name, account_number, area, is_active)")
        .eq("rep_id", repId);
      if (data) {
        const active = data.filter((d: any) => d.customers?.is_active).map((d: any) => d.customers);
        setAdHocCustomers(active);
        await setCachedCustomers(
          active.map((c: any) => ({ id: c.id, customer_name: c.customer_name, account_number: c.account_number || null, area: c.area || null }))
        );
      }
    } catch { /* online fetch failed, keep cache */ }
  };

  const submitAdHoc = async () => {
    if (!repId || !adHocCustomerId || !adHocArrival || !adHocLeaving) return;
    const dur = calcDuration(adHocArrival, adHocLeaving);
    if (dur <= 0) { toast.error("Leaving must be after arrival"); return; }
    setAdHocSubmitting(true);
    const adHocClientId = uuidv4();
    const customerName = adHocCustomers.find((c) => c.id === adHocCustomerId)?.customer_name;

    // Upload photo if captured
    let adHocPhotoUrl: string | null = null;
    if (adHocPhoto) {
      try {
        const { error: uploadErr } = await supabase.storage
          .from("visit-photos")
          .upload(`${adHocClientId}.jpg`, adHocPhoto.blob, { contentType: "image/jpeg", upsert: true });
        if (!uploadErr) {
          const { data: urlData } = supabase.storage.from("visit-photos").getPublicUrl(`${adHocClientId}.jpg`);
          adHocPhotoUrl = urlData?.publicUrl || null;
        } else {
          try {
            const b64 = await blobToBase64(adHocPhoto.blob);
            await savePendingPhoto(adHocClientId, b64, null, adHocClientId);
            toast.warning("Photo saved for upload — will retry when connection improves");
          } catch { /* IDB failure must not block submit */ }
        }
      } catch {
        try {
          const b64 = await blobToBase64(adHocPhoto.blob);
          await savePendingPhoto(adHocClientId, b64, null, adHocClientId);
          toast.warning("Photo saved for upload — will retry when connection improves");
        } catch { /* IDB failure must not block submit */ }
      }
    }

    try {
      const { error } = await supabase.from("visits").insert({
        rep_id: repId, customer_id: adHocCustomerId, visit_date: scheduleDate,
        arrival_time: adHocArrival, leaving_time: adHocLeaving, duration_minutes: dur, notes: adHocNotes || null,
        status: "visited",
        client_generated_id: adHocClientId,
        ...(adHocPhotoUrl ? { photo_url: adHocPhotoUrl } : {}),
        order_number: adHocOrderNumber || null,
        order_quantity: adHocOrderQty !== "" ? Number(adHocOrderQty) : null,
        order_amount: adHocOrderAmount !== "" ? Number(adHocOrderAmount) : null,
      });
      if (error) {
        if (isOfflineError(error)) {
          const photoB64 = adHocPhoto ? await blobToBase64(adHocPhoto.blob) : null;
          await saveVisitOffline(repId, adHocCustomerId, scheduleDate, adHocArrival, adHocLeaving, dur, adHocNotes || null, customerName, "visited", photoB64, adHocOrderNumber || null, adHocOrderQty !== "" ? Number(adHocOrderQty) : null, adHocOrderAmount !== "" ? Number(adHocOrderAmount) : null);
          toast.success("Saved offline. Will sync when online.");
          resetAdHoc();
        } else {
          toast.error(error.message);
        }
      } else {
        toast.success("Ad-hoc visit logged");
        resetAdHoc();
      }
    } catch (err: any) {
      console.warn("[Schedule] Network error on ad-hoc:", err?.message);
      try {
        const photoB64 = adHocPhoto ? await blobToBase64(adHocPhoto.blob) : null;
        await saveVisitOffline(repId, adHocCustomerId, scheduleDate, adHocArrival, adHocLeaving, dur, adHocNotes || null, customerName, "visited", photoB64, adHocOrderNumber || null, adHocOrderQty !== "" ? Number(adHocOrderQty) : null, adHocOrderAmount !== "" ? Number(adHocOrderAmount) : null);
        toast.success("Saved offline. Will sync when online.");
        resetAdHoc();
      } catch (idbErr) {
        console.error("[Schedule] IndexedDB save failed:", idbErr);
        toast.error("Failed to save visit. Please try again.");
      }
    }
    setAdHocSubmitting(false);
  };

  const resetAdHoc = () => {
    setExpandedBottomCard(null);
    setAdHocCustomerId(""); setAdHocArrival(""); setAdHocLeaving(""); setAdHocNotes("");
    setAdHocOrderNumber(""); setAdHocOrderQty(""); setAdHocOrderAmount("");
    if (adHocPhoto) URL.revokeObjectURL(adHocPhoto.preview);
    setAdHocPhoto(null);
  };

  const resetOffRoute = () => {
    setExpandedBottomCard(null);
    setOffRouteCustomerId(""); setOffRouteOrderNumber(""); setOffRouteOrderQty("");
    setOffRouteOrderAmount(""); setOffRouteNotes("");
  };

  const submitOffRoute = async () => {
    if (!repId || !offRouteCustomerId) { toast.error("Please select a customer"); return; }
    const hasOrder = offRouteOrderNumber || offRouteOrderQty !== "" || offRouteOrderAmount !== "";
    if (!hasOrder) { toast.error("Please fill in at least one order field"); return; }
    setOffRouteSubmitting(true);
    const clientId = uuidv4();
    const customerName = adHocCustomers.find((c) => c.id === offRouteCustomerId)?.customer_name;
    const payload: any = {
      rep_id: repId,
      customer_id: offRouteCustomerId,
      visit_date: scheduleDate,
      status: "off_route",
      order_number: offRouteOrderNumber || null,
      order_quantity: offRouteOrderQty !== "" ? Number(offRouteOrderQty) : null,
      order_amount: offRouteOrderAmount !== "" ? Number(offRouteOrderAmount) : null,
      notes: offRouteNotes || null,
      arrival_time: null,
      leaving_time: null,
      photo_url: null,
      client_generated_id: clientId,
    };
    const saveOffline = async () => {
      await addOfflineVisit({
        client_generated_id: clientId,
        payload,
        created_at_local: new Date().toISOString(),
        sync_status: "pending",
        last_sync_attempt: null,
        error_message: null,
        customer_name: customerName,
        photo_base64: null,
      });
    };
    try {
      if (navigator.onLine) {
        const { error } = await supabase.from("visits").insert(payload);
        if (error) {
          if (isOfflineError(error)) {
            await saveOffline();
            toast.success("Saved offline. Will sync when online.");
          } else {
            toast.error(error.message);
            setOffRouteSubmitting(false);
            return;
          }
        } else {
          toast.success("Off-route order logged");
        }
      } else {
        await saveOffline();
        toast.success("Saved offline. Will sync when online.");
      }
      resetOffRoute();
      fetchUnscheduledVisits();
    } catch (err: any) {
      console.warn("[Schedule] Network error on off-route:", err?.message);
      try {
        await saveOffline();
        toast.success("Saved offline. Will sync when online.");
        resetOffRoute();
      } catch {
        toast.error("Failed to save. Please try again.");
      }
    } finally {
      setOffRouteSubmitting(false);
    }
  };

  // ─── end-of-day summary logic ───────────────────────────────────────────────

  const isToday = scheduleDate === new Date().toISOString().split("T")[0];
  const allDone = items.length > 0 && items.every((i) => i.status === "visited" || i.status === "skipped");
  const dismissedKey = repId && scheduleDate ? `summary_dismissed_${repId}_${scheduleDate}` : null;

  // Detect in-progress visit with a saved photo (Fix 4 — recovery banner)
  useEffect(() => {
    if (!isToday || !items.length) { setRecoveryItemId(null); return; }
    const inProgress = items.find((i) => i.arrival_time && !i.leaving_time);
    if (!inProgress) { setRecoveryItemId(null); return; }

    (async () => {
      // Validate active_card_state against current schedule items before showing the banner.
      // If the stored ID belongs to a stale/deleted schedule or is already resolved, clear it.
      try {
        const card = await getActiveCard();
        if (card) {
          const storedItem = items.find((i) => i.id === card.scheduleItemId);
          const isStale = !storedItem
            || storedItem.status === "visited"
            || storedItem.status === "skipped"
            || !!storedItem.leaving_time;
          if (isStale) {
            clearActiveCard().catch(() => {});
            setRecoveryItemId(null);
            return;
          }
        }
      } catch { /* IDB unavailable — proceed to photo check */ }

      // Show banner only if there is a pending photo for the in-progress item
      try {
        const photo = await getPendingPhoto(inProgress.id);
        if (photo) {
          setRecoveryItemId(inProgress.id);
          setRecoveryCustomerName(inProgress.customers?.customer_name ?? null);
        } else {
          setRecoveryItemId(null);
        }
      } catch {
        setRecoveryItemId(null);
      }
    })();
  }, [items, isToday]); // eslint-disable-line react-hooks/exhaustive-deps

  // Read dismissed flag from localStorage whenever date or rep changes.
  // Also cleans up stale summary_dismissed_ keys older than 7 days.
  useEffect(() => {
    setSummaryDismissed(dismissedKey ? localStorage.getItem(dismissedKey) === "1" : false);

    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 7);
      const cutoffStr = cutoff.toISOString().slice(0, 10); // "YYYY-MM-DD"
      Object.keys(localStorage).forEach((key) => {
        if (!key.startsWith("summary_dismissed_")) return;
        // Key format: summary_dismissed_{repId}_{YYYY-MM-DD}
        const datePart = key.split("_").pop();
        if (datePart && datePart < cutoffStr) {
          localStorage.removeItem(key);
        }
      });
    } catch { /* localStorage unavailable — ignore */ }
  }, [dismissedKey]);

  const openSummary = useCallback(async () => {
    const visitedItems = items.filter((i) => i.status === "visited");
    const skippedItems = items.filter((i) => i.status === "skipped");

    let orders = 0;
    let totalOrderValue = 0;
    let histAvgOrders: number | null = null;
    let histAvgOrderValue: number | null = null;

    if (repId && navigator.onLine) {
      try {
        // Today's visit order data
        const { data: todayVisits } = await supabase
          .from("visits")
          .select("order_number, order_amount")
          .eq("rep_id", repId)
          .eq("visit_date", scheduleDate)
          .eq("status", "visited");
        if (todayVisits) {
          orders = todayVisits.filter((v) => v.order_number != null && v.order_number !== "").length;
          totalOrderValue = todayVisits.reduce((sum, v) => sum + (Number(v.order_amount) || 0), 0);
        }

        // Historical averages — same rep, same weekly template, same DOW, before today
        const weeklyTemplateId = schedule?.weekly_template_id;
        if (weeklyTemplateId) {
          const targetDow = new Date(scheduleDate + "T12:00:00").getDay();

          const { data: histSchedules } = await supabase
            .from("daily_schedules")
            .select("schedule_date")
            .eq("rep_id", repId)
            .eq("weekly_template_id", weeklyTemplateId)
            .lt("schedule_date", scheduleDate);

          if (histSchedules) {
            // Filter to same day-of-week client-side (PostgREST has no EXTRACT filter)
            const sameDowDates = histSchedules
              .filter((ds) => new Date(ds.schedule_date + "T12:00:00").getDay() === targetDow)
              .map((ds) => ds.schedule_date);

            if (sameDowDates.length >= 2) {
              const { data: histVisits } = await supabase
                .from("visits")
                .select("visit_date, order_number, order_amount")
                .eq("rep_id", repId)
                .eq("status", "visited")
                .in("visit_date", sameDowDates);

              if (histVisits) {
                // Per-day totals
                const perDay: Record<string, { orders: number; value: number }> = {};
                for (const d of sameDowDates) perDay[d] = { orders: 0, value: 0 };
                for (const v of histVisits) {
                  if (perDay[v.visit_date] !== undefined) {
                    if (v.order_number != null && v.order_number !== "") perDay[v.visit_date].orders++;
                    perDay[v.visit_date].value += Number(v.order_amount) || 0;
                  }
                }
                const days = Object.values(perDay);
                histAvgOrders = days.reduce((s, d) => s + d.orders, 0) / days.length;
                histAvgOrderValue = days.reduce((s, d) => s + d.value, 0) / days.length;
              }
            }
          }
        }
      } catch { /* offline or query error — omit historical comparison */ }
    }

    const durationsWithValue = visitedItems.filter((i) => i.duration_minutes > 0);
    const avgDuration =
      durationsWithValue.length > 0
        ? Math.round(durationsWithValue.reduce((s, i) => s + i.duration_minutes, 0) / durationsWithValue.length)
        : 0;

    setSummaryStats({
      total: items.length,
      visited: visitedItems.length,
      skipped: skippedItems.length,
      orders,
      totalOrderValue,
      avgDuration,
      histAvgOrders,
      histAvgOrderValue,
    });
    setShowSummary(true);
  }, [items, repId, scheduleDate, schedule]);

  const closeSummary = useCallback(() => {
    if (dismissedKey) localStorage.setItem(dismissedKey, "1");
    setSummaryDismissed(true);
    setShowSummary(false);
  }, [dismissedKey]);

  // Button handler — shows shimmer on the button while data fetches
  const handleViewSummary = useCallback(async () => {
    setIsLoadingSummary(true);
    await openSummary();
    setIsLoadingSummary(false);
  }, [openSummary]);

  // Auto-show for today only, once all items are done and not yet dismissed
  useEffect(() => {
    if (!allDone || !isToday || summaryDismissed || items.length === 0) return;
    openSummary();
  }, [allDone]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── date navigation ────────────────────────────────────────────────────────

  const changeDay = (delta: number) => {
    const [year, month, day] = scheduleDate.split("-").map(Number);
    const d = new Date(year, month - 1, day);
    d.setDate(d.getDate() + delta);
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    setScheduleDate(`${yy}-${mm}-${dd}`);
    setExpandedActiveId(null);
    setOpenCompletedId(null);
  };

  const displayDate = new Date(scheduleDate + "T00:00:00");
  const dateLabel = isToday
    ? "Today"
    : displayDate.toLocaleDateString("en-GB", { day: "numeric", month: "long" });

  // ─── render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="schedule-screen flex flex-col flex-1"
      style={{ background: C.bg, minHeight: "100dvh" }}
    >
      {/* offline banner */}
      {!isOnline && <OfflineBanner />}

      {/* header */}
      <div
        style={{
          background: `radial-gradient(120% 80% at 50% 0%, ${C.greenMid} 0%, ${C.green} 38%, ${C.greenDeep} 100%)`,
          padding: "10px 16px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img src="/logo.png" alt="Check-In" style={{ width: 28, height: 28, borderRadius: 6 }} />
            <span style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 15, color: "#fff", letterSpacing: "-0.2px" }}>Check-In</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 999, background: "rgba(255,255,255,0.14)", fontSize: 11.5, fontWeight: 600, color: "#fff" }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: isOnline ? "#7DDDA5" : "#E65100", boxShadow: isOnline ? "0 0 0 3px rgba(125,221,165,0.25)" : "none" }} />
              {isOnline ? "Online" : "Offline"}
            </div>
            <button
              type="button"
              onClick={signOut}
              title="Sign out"
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background: "rgba(255,255,255,0.14)",
                border: "none",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>

        {/* date navigation */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button
            type="button"
            onClick={() => changeDay(-1)}
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.14)",
              color: "#fff",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <ChevronLeft size={18} />
          </button>

          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: 10.5, color: "rgba(255,255,255,0.5)", margin: 0, marginBottom: 4, textTransform: "uppercase", fontWeight: 500, letterSpacing: "0.5px" }}>
              {displayDate.toLocaleDateString("en-GB", { weekday: "long" }).toUpperCase()}
              {currentWeekName ? ` · ${currentWeekName}` : ""}
            </p>
            <p style={{ fontFamily: "Syne, sans-serif", fontSize: 26, fontWeight: 700, color: "#fff", margin: 0, lineHeight: 1.2 }}>
              {dateLabel}
            </p>
          </div>

          <button
            type="button"
            onClick={() => changeDay(1)}
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.14)",
              color: "#fff",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {!loading && !generating && items.length > 0 && (
  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 0 }}>
    <div style={{ textAlign: "center", paddingRight: 8 }}>
      <p style={{ fontFamily: "Syne, sans-serif", fontSize: 36, fontWeight: 700, color: "#fff", margin: 0, lineHeight: 1, letterSpacing: "-0.8px" }}>
        {visitedCount}
      </p>
      <p style={{ fontSize: 9, color: "rgba(255,255,255,0.7)", margin: 0, marginTop: 3, textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>Done</p>
    </div>
    <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 300, fontSize: 18, color: "rgba(255,255,255,0.25)", lineHeight: 1, paddingBottom: 16 }}>/</div>
    <div style={{ textAlign: "center", paddingLeft: 8, paddingRight: 8, paddingTop: 4 }}>
      <p style={{ fontFamily: "Syne, sans-serif", fontSize: 22, fontWeight: 700, color: "rgba(255,255,255,0.55)", margin: 0, lineHeight: 1, letterSpacing: "-0.6px" }}>
        {activeItems.length}
      </p>
      <p style={{ fontSize: 9.5, color: "rgba(255,255,255,0.55)", margin: 0, marginTop: 3, textTransform: "uppercase", letterSpacing: "1.3px", fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>Remaining</p>
    </div>
    <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 300, fontSize: 18, color: "rgba(255,255,255,0.25)", lineHeight: 1, paddingBottom: 16 }}>/</div>
    <div style={{ textAlign: "center", paddingLeft: 8 }}>
      <p style={{ fontFamily: "Syne, sans-serif", fontSize: 28, fontWeight: 700, color: "rgba(255,255,255,0.7)", margin: 0, lineHeight: 1, letterSpacing: "-0.8px" }}>
        {totalCount}
      </p>
      <p style={{ fontSize: 9.5, color: "rgba(255,255,255,0.7)", margin: 0, marginTop: 3, textTransform: "uppercase", letterSpacing: "1.3px", fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>Total</p>
    </div>
  </div>
)}

        {/* progress pill */}
        {items.length > 0 && (
          <div
            style={{
              height: 6,
              borderRadius: 999,
              background: "rgba(255,255,255,0.14)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progress * 100}%`,
                background: `linear-gradient(90deg, ${C.sun} 0%, #fff 100%)`,
                transition: "width 500ms cubic-bezier(0.22, 0.61, 0.36, 1)",
                borderRadius: 999,
              }}
            />
          </div>
        )}
      </div>

      {/* tab bar */}
      {!loading && !generating && schedule && (
        <div
          style={{
            padding: "4px",
            display: "flex",
            gap: 0,
            borderRadius: 999,
            background: "#E2D9C6",
            margin: "8px 16px",
            width: "calc(100% - 32px)",
          }}
        >
          {(["active", "done"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 700,
                fontFamily: "Syne, sans-serif",
                border: "none",
                cursor: "pointer",
                background: activeTab === tab ? "#fff" : "transparent",
                color: activeTab === tab ? C.ink : C.inkSoft,
                transition: "all 200ms ease",
                boxShadow: activeTab === tab ? "0 2px 8px rgba(23, 23, 21, 0.12)" : "none",
              }}
            >
              {tab === "active"
                ? `Active${activeItems.length > 0 ? ` (${activeItems.length})` : ""}`
                : `Done${completedItems.length + unscheduledVisits.length > 0 ? ` (${completedItems.length + unscheduledVisits.length})` : ""}`}
            </button>
          ))}
        </div>
      )}

      {/* in-progress visit recovery banner */}
      {recoveryItemId && !loading && activeTab === "active" && (
        <button
          type="button"
          onClick={() => {
            setExpandedActiveId(recoveryItemId);
            setActiveTab("active");
            setTimeout(() => {
              document.getElementById(`card-${recoveryItemId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 100);
          }}
          className="mx-4 mt-2 w-[calc(100%-2rem)] flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium font-syne text-left"
          style={{ background: "#FFF8E1", border: "1px solid #F59E0B", color: "#78350F" }}
        >
          <ChevronRight size={16} className="shrink-0" style={{ color: "#F59E0B" }} />
          <span>You have an active visit at <strong>{recoveryCustomerName}</strong> — tap to resume</span>
        </button>
      )}

      {/* main scrollable area */}
      <div className="flex-1 overflow-y-auto scrollbar-hidden px-4 pb-6 pt-3 space-y-2">
        {loading || generating ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3" style={{ color: C.textMuted }}>
            <Loader2 className="animate-spin" size={28} />
            <p className="text-sm">{generating ? "Generating schedule…" : "Loading…"}</p>
          </div>
        ) : !schedule ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2" style={{ color: C.textMuted }}>
            <CalendarDays size={40} style={{ opacity: 0.3 }} />
            <p className="text-sm">
              {scheduleDate > new Date().toISOString().split("T")[0]
                ? "Schedule not yet available"
                : "No schedule for this date"}
            </p>
          </div>
        ) : activeTab === "active" ? (
          <>
            {allDone && (
              <div
                style={{
                  borderRadius: 12,
                  padding: "12px 16px",
                  background: `linear-gradient(135deg, ${C.greenSoft} 0%, rgba(221, 233, 225, 0.5) 100%)`,
                  border: `1px solid ${C.greenSoft}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: C.green,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      flexShrink: 0,
                    }}
                  >
                    <Check size={16} strokeWidth={3} />
                  </div>
                  <div>
                    <p style={{ fontFamily: "Syne, sans-serif", fontSize: 14, fontWeight: 600, color: C.greenInk, margin: 0 }}>
                      Day complete
                    </p>
                    <p style={{ fontSize: 12, color: C.inkMute, margin: 0, marginTop: 2 }}>All visits accounted for</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleViewSummary}
                  disabled={isLoadingSummary}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 600,
                    background: C.green,
                    color: "#fff",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  View summary
                </button>
              </div>
            )}
            {activeItems.length === 0 ? (
              allDone ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3" style={{ color: C.textMuted }}>
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center"
                  style={{ background: C.greenBg, border: `2px solid ${C.greenLight}` }}
                >
                  <Check size={26} style={{ color: C.green }} strokeWidth={2.5} />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-bold font-syne" style={{ color: C.text }}>Day complete</p>
                  <p className="text-xs" style={{ color: C.textMuted }}>All visits accounted for</p>
                </div>
                <button
                  type="button"
                  onClick={handleViewSummary}
                  disabled={isLoadingSummary}
                  className={`text-xs font-medium px-4 py-2 rounded-xl mt-1${isLoadingSummary ? " btn-shimmer" : ""}`}
                  style={isLoadingSummary ? undefined : { color: C.green, border: `1px solid ${C.border}`, background: C.card }}
                >
                  View {isToday ? "today's" : "day's"} summary
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 gap-2" style={{ color: C.textMuted }}>
                <Check size={40} style={{ color: C.greenLight, opacity: 0.7 }} />
                <p className="text-sm font-semibold font-syne">All visits done!</p>
              </div>
            )
          ) : (
            activeItems.map((item, i) => (
              <ScheduleCard
                key={item.id}
                item={item}
                repId={repId!}
                scheduleDate={scheduleDate}
                onRefresh={fetchSchedule}
                onLocalUpdate={handleLocalUpdate}
                isExpanded={expandedActiveId === item.id}
                onToggle={() => setExpandedActiveId((prev) => (prev === item.id ? null : item.id))}
                index={i}
                allItems={items}
              />
            ))
          )
            }
          </>
        ) : (
          completedItems.length === 0 && unscheduledVisits.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2" style={{ color: C.textMuted }}>
              <p className="text-sm">No completed visits yet</p>
            </div>
          ) : (
            <>
              {(completedItems.length > 0 || unscheduledVisits.length > 0) && (
                <div
                  style={{
                    margin: "16px",
                    padding: "12px 16px",
                    borderRadius: 12,
                    background: C.surface,
                    border: `1px solid ${C.border}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-around",
                    gap: 16,
                  }}
                >
                  <div style={{ flex: 1, textAlign: "center", borderRight: `1px solid ${C.border}` }}>
                    <p style={{ fontSize: 11, color: C.inkMute, textTransform: "uppercase", fontWeight: 500, margin: 0, marginBottom: 6 }}>
                      Avg per stop
                    </p>
                    <p style={{ fontSize: 16, fontFamily: "Syne, sans-serif", fontWeight: 600, color: C.ink, margin: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                      <Clock size={14} />
                      {visitedCount > 0 ? fmtDuration(Math.round(items.filter(i => i.status === "visited").reduce((sum, i) => sum + (i.duration_minutes || 0), 0) / visitedCount * 60)) : "—"}
                    </p>
                  </div>
                  <div style={{ flex: 1, textAlign: "center", borderRight: `1px solid ${C.border}` }}>
                    <p style={{ fontSize: 11, color: C.inkMute, textTransform: "uppercase", fontWeight: 500, margin: 0, marginBottom: 6 }}>
                      Visited
                    </p>
                    <p style={{ fontSize: 16, fontFamily: "Syne, sans-serif", fontWeight: 600, color: C.green, margin: 0 }}>
                      {visitedCount}
                    </p>
                  </div>
                  <div style={{ flex: 1, textAlign: "center" }}>
                    <p style={{ fontSize: 11, color: C.inkMute, textTransform: "uppercase", fontWeight: 500, margin: 0, marginBottom: 6 }}>
                      Skipped
                    </p>
                    <p style={{ fontSize: 16, fontFamily: "Syne, sans-serif", fontWeight: 600, color: C.danger, margin: 0 }}>
                      {completedItems.filter(i => i.status === "skipped").length}
                    </p>
                  </div>
                </div>
              )}
              {completedItems.map((item, i) => (
                <ScheduleCard
                  key={item.id}
                  item={item}
                  repId={repId!}
                  scheduleDate={scheduleDate}
                  onRefresh={fetchSchedule}
                  onLocalUpdate={handleLocalUpdate}
                  isExpanded={openCompletedId === item.id}
                  onToggle={() => setOpenCompletedId((prev) => (prev === item.id ? null : item.id))}
                  index={i}
                  allItems={items}
                />
              ))}

              {unscheduledVisits.map((visit) => {
                const isEditing = unscheduledEditingId === visit.id;
                const customerName = visit.customers?.customer_name ?? "Unknown";
                const isOffRoute = visit.status === "off_route";
                return (
                  <div
                    key={visit.id}
                    className="rounded-2xl overflow-hidden"
                    style={{ background: C.card, border: `1.5px solid ${C.greenLight}` }}
                  >
                    {/* header row */}
                    <div className="w-full flex items-center gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate font-syne" style={{ color: C.text }}>{customerName}</p>
                      </div>
                      {isOffRoute ? (
                        <span
                          className="text-[11px] font-semibold px-2 py-0.5 rounded-full font-syne shrink-0"
                          style={{ background: "#FFF3E0", color: "#B45309" }}
                        >
                          Off-Route Order
                        </span>
                      ) : (
                        <span
                          className="text-[11px] font-semibold px-2 py-0.5 rounded-full font-syne shrink-0"
                          style={{ background: C.orangeBg, color: C.orange }}
                        >
                          Unscheduled
                        </span>
                      )}
                    </div>

                    {/* details body */}
                    <div className="px-4 pb-4 space-y-3" style={{ borderTop: `1px solid ${C.border}` }}>
                      <div className="pt-3">
                        <div className="flex gap-3 items-start">
                          <div className="flex-1 space-y-1.5">

                            {/* times — hidden for off-route orders */}
                            {!isOffRoute && visit.arrival_time && visit.leaving_time && (
                              <div className="flex items-center gap-3">
                                <div className="flex items-center gap-1">
                                  <span className="text-[10px] font-medium" style={{ color: C.textMuted }}>In:</span>
                                  <span className="text-sm font-medium" style={{ color: C.text }}>{visit.arrival_time?.slice(0, 5)}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="text-[10px] font-medium" style={{ color: C.textMuted }}>Out:</span>
                                  <span className="text-sm font-medium" style={{ color: C.text }}>{visit.leaving_time?.slice(0, 5)}</span>
                                </div>
                                {visit.duration_minutes > 0 && (
                                  <div className="flex items-center gap-1">
                                    <span className="text-[10px] font-medium" style={{ color: C.textMuted }}>Dur:</span>
                                    <span className="text-sm font-medium" style={{ color: C.text }}>{visit.duration_minutes}m</span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* order details */}
                            {(visit.order_number || visit.order_quantity != null || visit.order_amount != null) && (
                              <div className="flex items-center gap-3 flex-wrap">
                                {visit.order_number && (
                                  <div className="flex items-center gap-1">
                                    <span className="text-[10px] font-medium" style={{ color: C.textMuted }}>Order:</span>
                                    <span className="text-sm" style={{ color: C.text }}>{visit.order_number}</span>
                                  </div>
                                )}
                                {visit.order_quantity != null && (
                                  <div className="flex items-center gap-1">
                                    <span className="text-[10px] font-medium" style={{ color: C.textMuted }}>Qty:</span>
                                    <span className="text-sm" style={{ color: C.text }}>{visit.order_quantity}</span>
                                  </div>
                                )}
                                {visit.order_amount != null && (
                                  <div className="flex items-center gap-1">
                                    <span className="text-[10px] font-medium" style={{ color: C.textMuted }}>Amt:</span>
                                    <span className="text-sm" style={{ color: C.text }}>R {Number(visit.order_amount).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* notes */}
                            {visit.notes && (
                              <p className="text-xs italic" style={{ color: C.textMuted }}>"{visit.notes}"</p>
                            )}

                            {/* Edit Order button / inline form */}
                            {!isEditing && (
                              <button
                                type="button"
                                onClick={() => {
                                  setUnscheduledOrderNumber(visit.order_number || "");
                                  setUnscheduledOrderQty(visit.order_quantity != null ? String(visit.order_quantity) : "");
                                  setUnscheduledOrderAmount(visit.order_amount != null ? String(visit.order_amount) : "");
                                  setUnscheduledEditingId(visit.id);
                                }}
                                className="text-xs font-medium mt-2 px-3 py-1.5 rounded-lg"
                                style={{ color: C.green, border: `1px solid ${C.border}`, background: C.bg }}
                              >
                                <Pencil size={11} className="inline mr-1" /> Edit Order
                              </button>
                            )}

                            {isEditing && (
                              <div className="mt-2 space-y-2">
                                <div className="grid grid-cols-3 gap-2">
                                  <div>
                                    <label className="text-[10px] font-medium" style={{ color: C.textMuted }}>Order No.</label>
                                    <Input
                                      value={unscheduledOrderNumber}
                                      onChange={(e) => setUnscheduledOrderNumber(e.target.value)}
                                      onBlur={resetMobileZoom}
                                      className="h-8 text-sm"
                                      style={{ borderColor: C.border, background: C.bg }}
                                      placeholder="Order #"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-medium" style={{ color: C.textMuted }}>Qty</label>
                                    <Input
                                      type="number" min="0" step="1"
                                      value={unscheduledOrderQty}
                                      onChange={(e) => setUnscheduledOrderQty(e.target.value)}
                                      onBlur={resetMobileZoom}
                                      className="h-8 text-sm"
                                      style={{ borderColor: C.border, background: C.bg }}
                                      placeholder="0"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-medium" style={{ color: C.textMuted }}>Amount</label>
                                    <Input
                                      type="number" min="0" step="0.01"
                                      value={unscheduledOrderAmount}
                                      onChange={(e) => setUnscheduledOrderAmount(e.target.value)}
                                      onBlur={resetMobileZoom}
                                      className="h-8 text-sm"
                                      style={{ borderColor: C.border, background: C.bg }}
                                      placeholder="0.00"
                                    />
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setUnscheduledEditingId(null)}
                                    className="text-xs px-3 py-1.5 rounded-lg"
                                    style={{ color: C.textMuted, border: `1px solid ${C.border}` }}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    disabled={unscheduledActionInProgress}
                                    onClick={async () => {
                                      setUnscheduledActionInProgress(true);
                                      try {
                                        const { error } = await supabase.from("visits").update({
                                          order_number: unscheduledOrderNumber || null,
                                          order_quantity: unscheduledOrderQty !== "" ? Number(unscheduledOrderQty) : null,
                                          order_amount: unscheduledOrderAmount !== "" ? Number(unscheduledOrderAmount) : null,
                                        } as any).eq("id", visit.id);
                                        if (error) {
                                          toast.error(error.message);
                                        } else {
                                          toast.success("Order updated");
                                          setUnscheduledEditingId(null);
                                          await fetchUnscheduledVisits();
                                        }
                                      } catch {
                                        toast.error("Failed to update");
                                      } finally {
                                        setUnscheduledActionInProgress(false);
                                      }
                                    }}
                                    className="text-xs px-3 py-1.5 rounded-lg font-medium"
                                    style={{ background: C.green, color: "#fff" }}
                                  >
                                    {unscheduledActionInProgress ? "Saving..." : "Update"}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* photo thumbnail — hidden for off-route orders */}
                          {!isOffRoute && visit.photo_url && (
                            <div className="shrink-0">
                              <img
                                src={visit.photo_url}
                                alt="Visit photo"
                                className="w-16 h-16 object-cover rounded-xl"
                                style={{ border: `1px solid ${C.border}` }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )
        )}

        {/* end-of-day summary modal */}
        {showSummary && summaryStats && (
          <EodSummaryModal stats={summaryStats} onClose={closeSummary} />
        )}

        {/* bottom action cards — side by side when collapsed, full-width when expanded */}
        {schedule && (
          <div style={{ padding: "8px 16px" }}>

            {/* collapsed: two cards sitting side by side */}
            {expandedBottomCard === null && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <button
                  type="button"
                  onClick={() => setExpandedBottomCard("unscheduled")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    padding: "12px 16px",
                    borderRadius: 16,
                    fontSize: 14,
                    fontWeight: 500,
                    border: `1.5px dashed ${C.border}`,
                    background: "transparent",
                    color: C.inkMute,
                    cursor: "pointer",
                  }}
                >
                  <Plus size={16} />
                  <span>Unscheduled</span>
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedBottomCard("offroute")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    padding: "12px 16px",
                    borderRadius: 16,
                    fontSize: 14,
                    fontWeight: 500,
                    border: `1.5px dashed ${C.border}`,
                    background: "transparent",
                    color: C.inkMute,
                    cursor: "pointer",
                  }}
                >
                  <Plus size={16} />
                  <span>Off-Route Order</span>
                </button>
              </div>
            )}

            {/* expanded: unscheduled visit form */}
            {expandedBottomCard === "unscheduled" && (
              <div style={{ borderRadius: 16, overflow: "hidden", background: C.surface, border: `1.5px solid ${C.greenSoft}` }}>
                {/* Green gradient top bar */}
                <div style={{ height: 3, background: `linear-gradient(90deg, ${C.greenMid} 0%, ${C.green} 100%)` }} />

                {/* Header */}
                <div style={{ padding: "16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        background: C.greenSoft,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: C.green,
                      }}
                    >
                      <Pin size={14} />
                    </div>
                    <div>
                      <p style={{ fontFamily: "Syne, sans-serif", fontSize: 14, fontWeight: 600, color: C.ink, margin: 0 }}>
                        Unscheduled visit
                      </p>
                      <p style={{ fontSize: 11, color: C.inkMute, margin: 0, marginTop: 2 }}>Add a customer visit off your route</p>
                    </div>
                  </div>
                  <button type="button" onClick={resetAdHoc} style={{ background: "none", border: "none", color: C.inkMute, cursor: "pointer", padding: 0 }}>
                    <X size={16} />
                  </button>
                </div>

                <Expand open={expandedBottomCard === "unscheduled"}>
                  {/* Form content */}
                  <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>

                <div>
                  <Label className="text-xs" style={{ color: C.textMuted }}>Customer</Label>
                  <SearchableSelect
                    options={[...adHocCustomers]
                      .sort((a, b) => a.customer_name.localeCompare(b.customer_name))
                      .map((c) => ({ value: c.id, label: c.customer_name }))}
                    value={adHocCustomerId}
                    onValueChange={setAdHocCustomerId}
                    placeholder="Search customers..."
                    searchPlaceholder="Search customers..."
                    emptyMessage="No customers found"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs" style={{ color: C.textMuted }}>Arrival</Label>
                    <div className="flex gap-1">
                      <Input type="time" value={adHocArrival} onChange={(e) => setAdHocArrival(e.target.value)}
                        onBlur={resetMobileZoom}
                        className="h-9 text-sm time-input-clean" style={{ borderColor: C.border, background: C.bg }} />
                      <Button type="button" variant="outline" size="sm" className="h-9 px-2 shrink-0"
                        onClick={() => setAdHocArrival(nowTime())} style={{ borderColor: C.border }}>
                        <Clock size={13} />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs" style={{ color: C.textMuted }}>Leaving</Label>
                    <div className="flex gap-1">
                      <Input type="time" value={adHocLeaving} onChange={(e) => setAdHocLeaving(e.target.value)}
                        onBlur={resetMobileZoom}
                        className="h-9 text-sm time-input-clean" style={{ borderColor: C.border, background: C.bg }} />
                      <Button type="button" variant="outline" size="sm" className="h-9 px-2 shrink-0"
                        onClick={() => setAdHocLeaving(nowTime())} style={{ borderColor: C.border }}>
                        <Clock size={13} />
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-xs" style={{ color: C.textMuted }}>Order No.</Label>
                    <Input value={adHocOrderNumber} onChange={(e) => setAdHocOrderNumber(e.target.value)}
                      onBlur={resetMobileZoom}
                      className="h-9 text-sm" style={{ borderColor: C.border, background: C.bg }} placeholder="Order #" />
                  </div>
                  <div>
                    <Label className="text-xs" style={{ color: C.textMuted }}>Qty</Label>
                    <Input type="number" min="0" step="1" value={adHocOrderQty} onChange={(e) => setAdHocOrderQty(e.target.value)}
                      onBlur={resetMobileZoom}
                      className="h-9 text-sm" style={{ borderColor: C.border, background: C.bg }} placeholder="0" />
                  </div>
                  <div>
                    <Label className="text-xs" style={{ color: C.textMuted }}>Amount</Label>
                    <Input type="number" min="0" step="0.01" value={adHocOrderAmount} onChange={(e) => setAdHocOrderAmount(e.target.value)}
                      onBlur={resetMobileZoom}
                      className="h-9 text-sm" style={{ borderColor: C.border, background: C.bg }} placeholder="0.00" />
                  </div>
                </div>

                <div>
                  <Label className="text-xs" style={{ color: C.textMuted }}>Notes</Label>
                  <Textarea value={adHocNotes} onChange={(e) => setAdHocNotes(e.target.value)}
                    onBlur={resetMobileZoom} rows={2}
                    className="text-sm resize-none" style={{ borderColor: C.border, background: C.bg }} />
                </div>

                {/* photo */}
                <div>
                  {adHocPhoto ? (
                    <div className="relative inline-block">
                      <img src={adHocPhoto.preview} alt="Store photo" className="h-20 w-20 object-cover rounded-xl" style={{ border: `1px solid ${C.border}` }} />
                      <button type="button" onClick={() => {
                        URL.revokeObjectURL(adHocPhoto.preview);
                        setAdHocPhoto(null);
                      }}
                        className="absolute -top-1 -right-1 rounded-full p-0.5"
                        style={{ background: C.danger, color: "#fff" }}>
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <CameraCapture onCapture={async (blob) => {
                      try {
                        const compressed = await compressImage(blob);
                        const preview = URL.createObjectURL(compressed);
                        setAdHocPhoto({ blob: compressed, preview });
                      } catch {
                        toast.error("Failed to process photo");
                      }
                    }} triggerClassName="h-8 text-xs" />
                  )}
                </div>

                {/* What happens next stepper */}
                <div style={{ padding: "12px", borderRadius: 12, background: C.cream, display: "flex", alignItems: "center", gap: 6 }}>
                  {[
                    { icon: "→", label: "Arrive" },
                    { icon: "📷", label: "Photo" },
                    { icon: "📋", label: "Order" },
                    { icon: "←", label: "Leave" },
                  ].map((step, idx) => (
                    <div key={idx} style={{ flex: 1, textAlign: "center" }}>
                      <div style={{ fontSize: 12, marginBottom: 4 }}>{step.icon}</div>
                      <p style={{ fontSize: 10, fontWeight: 500, color: C.inkMute, margin: 0 }}>{step.label}</p>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <Button
                    type="button"
                    onClick={resetAdHoc}
                    className="flex-1 h-11 font-syne font-semibold"
                    style={{ background: "transparent", color: C.inkSoft, border: `1px solid ${C.border}` }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={submitAdHoc}
                    disabled={adHocSubmitting || !adHocCustomerId || !adHocArrival || !adHocLeaving}
                    className="flex-1 h-11 font-syne font-semibold"
                    style={adHocSubmitting ? {
                      background: `linear-gradient(90deg, ${C.greenMid} 25%, ${C.green} 50%, ${C.greenMid} 75%)`,
                      backgroundSize: "200% 100%",
                      animationName: "btn-shimmer",
                      animationDuration: "1.2s",
                      animationIterationCount: "infinite",
                      animationTimingFunction: "linear",
                      color: "#fff",
                    } : { background: `linear-gradient(135deg, ${C.greenMid} 0%, ${C.green} 100%)`, color: "#fff" }}
                  >
                    <Pin size={14} style={{ marginRight: 4 }} />
                    Start visit
                  </Button>
                </div>
                  </div>
                </Expand>
              </div>
            )}

            {/* expanded: off-route order form */}
            {expandedBottomCard === "offroute" && (
              <div style={{ borderRadius: 16, overflow: "hidden", background: C.surface, border: `1.5px solid rgba(230, 182, 82, 0.35)` }}>
                {/* Sun gradient top bar */}
                <div style={{ height: 3, background: `linear-gradient(90deg, ${C.sun} 0%, #FFD966 100%)` }} />

                {/* Header */}
                <div style={{ padding: "16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        background: "rgba(230, 182, 82, 0.15)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: C.sun,
                      }}
                    >
                      <Plus size={14} />
                    </div>
                    <div>
                      <p style={{ fontFamily: "Syne, sans-serif", fontSize: 14, fontWeight: 600, color: C.ink, margin: 0 }}>
                        Off-Route order
                      </p>
                      <p style={{ fontSize: 11, color: C.inkMute, margin: 0, marginTop: 2 }}>Log a sale outside your route</p>
                    </div>
                  </div>
                  <button type="button" onClick={resetOffRoute} style={{ background: "none", border: "none", color: C.inkMute, cursor: "pointer", padding: 0 }}>
                    <X size={16} />
                  </button>
                </div>

                <Expand open={expandedBottomCard === "offroute"}>
                  {/* Form content */}
                  <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>

                  <div>
                  <Label className="text-xs" style={{ color: C.textMuted }}>Customer</Label>
                  <SearchableSelect
                    options={[...adHocCustomers]
                      .sort((a, b) => a.customer_name.localeCompare(b.customer_name))
                      .map((c) => ({ value: c.id, label: c.customer_name }))}
                    value={offRouteCustomerId}
                    onValueChange={setOffRouteCustomerId}
                    placeholder="Search customers..."
                    searchPlaceholder="Search customers..."
                    emptyMessage="No customers found"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-xs" style={{ color: C.textMuted }}>Order No.</Label>
                    <Input value={offRouteOrderNumber} onChange={(e) => setOffRouteOrderNumber(e.target.value)}
                      onBlur={resetMobileZoom}
                      className="h-9 text-sm" style={{ borderColor: C.border, background: C.bg }} placeholder="Order #" />
                  </div>
                  <div>
                    <Label className="text-xs" style={{ color: C.textMuted }}>Qty</Label>
                    <Input type="number" min="0" step="1" value={offRouteOrderQty} onChange={(e) => setOffRouteOrderQty(e.target.value)}
                      onBlur={resetMobileZoom}
                      className="h-9 text-sm" style={{ borderColor: C.border, background: C.bg }} placeholder="0" />
                  </div>
                  <div>
                    <Label className="text-xs" style={{ color: C.textMuted }}>Amount</Label>
                    <Input type="number" min="0" step="0.01" value={offRouteOrderAmount} onChange={(e) => setOffRouteOrderAmount(e.target.value)}
                      onBlur={resetMobileZoom}
                      className="h-9 text-sm" style={{ borderColor: C.border, background: C.bg }} placeholder="0.00" />
                  </div>
                </div>

                <div>
                  <Label className="text-xs" style={{ color: C.textMuted }}>Notes</Label>
                  <Textarea value={offRouteNotes} onChange={(e) => setOffRouteNotes(e.target.value)}
                    onBlur={resetMobileZoom} rows={2}
                    className="text-sm resize-none" style={{ borderColor: C.border, background: C.bg }} />
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <Button
                    type="button"
                    onClick={resetOffRoute}
                    className="flex-1 h-11 font-syne font-semibold"
                    style={{ background: "transparent", color: C.inkSoft, border: `1px solid ${C.border}` }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={submitOffRoute}
                    disabled={offRouteSubmitting || !offRouteCustomerId}
                    className="flex-1 h-11 font-syne font-semibold"
                    style={offRouteSubmitting ? {
                      background: `linear-gradient(90deg, ${C.greenMid} 25%, ${C.green} 50%, ${C.greenMid} 75%)`,
                      backgroundSize: "200% 100%",
                      animationName: "btn-shimmer",
                      animationDuration: "1.2s",
                      animationIterationCount: "infinite",
                      animationTimingFunction: "linear",
                      color: "#fff",
                    } : { background: `linear-gradient(135deg, ${C.greenMid} 0%, ${C.green} 100%)`, color: "#fff" }}
                  >
                    Log order
                  </Button>
                </div>
                  </div>
                </Expand>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
