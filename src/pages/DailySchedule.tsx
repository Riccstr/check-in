import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
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
  Home, ClipboardList, User, Wifi, WifiOff,
} from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { compressImage, blobToBase64 } from "@/lib/imageCompressor";
import { CameraCapture } from "@/components/CameraCapture";
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
  bg:          "#F4F1EC",
  card:        "#FEFCF9",
  green:       "#1D5C3F",
  greenMid:    "#2D7A50",
  greenLight:  "#4CAF78",
  text:        "#1A1A1A",
  textMuted:   "#6B7280",
  border:      "#E5E0D8",
  orange:      "#E65100",
  orangeBg:    "#FFF3E0",
  red:         "#C62828",
  redBg:       "#FFF0F0",
  greenBg:     "#E8F5EE",
  header:      "#1A3328",
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

function fmtDuration(mins: number): string {
  if (mins <= 0) return "—";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function EodSummaryModal({ stats, onClose }: { stats: SummaryStats; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl px-5 pt-6 pb-8 space-y-5"
        style={{ background: C.card, border: `1px solid ${C.border}` }}
      >
        {/* checkmark header */}
        <div className="flex flex-col items-center gap-2 pb-1">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ background: C.greenBg, border: `2px solid ${C.greenLight}` }}
          >
            <Check size={30} style={{ color: C.green }} strokeWidth={2.5} />
          </div>
          <h2 className="font-syne font-bold text-xl" style={{ color: C.text }}>Day Complete</h2>
          <p className="text-sm" style={{ color: C.textMuted }}>Here's how today went</p>
        </div>

        {/* stats grid — 2 columns */}
        <div className="grid grid-cols-2 gap-2">
          {/* Scheduled */}
          <div className="rounded-xl px-4 py-3" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
            <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: C.textMuted }}>Scheduled</p>
            <p className="text-2xl font-bold font-syne leading-tight mt-0.5" style={{ color: C.text }}>{stats.total}</p>
          </div>
          {/* Visited */}
          <div className="rounded-xl px-4 py-3" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
            <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: C.textMuted }}>Visited</p>
            <p className="text-2xl font-bold font-syne leading-tight mt-0.5" style={{ color: C.green }}>{stats.visited}</p>
          </div>
          {/* Skipped */}
          <div className="rounded-xl px-4 py-3" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
            <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: C.textMuted }}>Skipped</p>
            <p className="text-2xl font-bold font-syne leading-tight mt-0.5" style={{ color: C.text }}>{stats.skipped}</p>
          </div>
          {/* Orders — with historical comparison */}
          <div className="rounded-xl px-4 py-3" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
            <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: C.textMuted }}>Orders</p>
            <p className="text-2xl font-bold font-syne leading-tight mt-0.5" style={{ color: C.green }}>{stats.orders}</p>
            {stats.histAvgOrders !== null && (
              <p className="text-xs mt-1" style={{
                color: stats.orders > stats.histAvgOrders ? C.green
                     : stats.orders < stats.histAvgOrders ? C.orange
                     : C.textMuted,
              }}>
                Avg for this day: {stats.histAvgOrders.toFixed(1)}
              </p>
            )}
          </div>
        </div>

        {/* wide stats row */}
        <div className="grid grid-cols-2 gap-2">
          {/* Order Value — with historical comparison */}
          <div className="rounded-xl px-4 py-3" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
            <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: C.textMuted }}>Order Value</p>
            <p className="text-lg font-bold font-syne leading-tight mt-0.5" style={{ color: C.green }}>
              R {stats.totalOrderValue.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
            </p>
            {stats.histAvgOrderValue !== null && (
              <p className="text-xs mt-1" style={{
                color: stats.totalOrderValue > stats.histAvgOrderValue ? C.green
                     : stats.totalOrderValue < stats.histAvgOrderValue ? C.orange
                     : C.textMuted,
              }}>
                Avg for this day: R {stats.histAvgOrderValue.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </p>
            )}
          </div>
          {/* Avg Time */}
          <div className="rounded-xl px-4 py-3" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
            <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: C.textMuted }}>Avg Time</p>
            <p className="text-2xl font-bold font-syne leading-tight mt-0.5" style={{ color: C.text }}>
              {fmtDuration(stats.avgDuration)}
            </p>
          </div>
        </div>

        {/* done button */}
        <button
          type="button"
          onClick={onClose}
          className="w-full h-11 rounded-xl font-syne font-semibold text-sm"
          style={{ background: C.green, color: "#fff" }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

// ─── VisitDetailsText / VisitPhotoOnly ────────────────────────────────────────
// Split components for completed visit data. Both use two lookup strategies to
// handle offline-synced visits where visit_id may not yet be on schedule_items.

function VisitDetailsText({ visitId, repId, customerId, scheduleDate }: { visitId: string | null; repId: string; customerId: string; scheduleDate: string }) {
  const [visitData, setVisitData] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchVisit = async () => {
      let data: any = null;
      if (visitId) {
        const res = await supabase.from("visits").select("order_number, order_quantity, order_amount").eq("id", visitId).maybeSingle();
        data = res.data;
      }
      if (!data) {
        const res = await supabase.from("visits").select("order_number, order_quantity, order_amount").eq("rep_id", repId).eq("customer_id", customerId).eq("visit_date", scheduleDate).order("created_at", { ascending: false }).limit(1).maybeSingle();
        data = res.data;
      }
      if (!cancelled && data) setVisitData(data);
    };
    fetchVisit();
    return () => { cancelled = true; };
  }, [visitId, repId, customerId, scheduleDate]);

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
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchPhoto = async () => {
      let data: any = null;
      if (visitId) {
        const res = await supabase.from("visits").select("photo_url").eq("id", visitId).maybeSingle();
        data = res.data;
      }
      if (!data) {
        const res = await supabase.from("visits").select("photo_url").eq("rep_id", repId).eq("customer_id", customerId).eq("visit_date", scheduleDate).order("created_at", { ascending: false }).limit(1).maybeSingle();
        data = res.data;
      }
      if (!cancelled && data?.photo_url) setPhotoUrl(data.photo_url);
    };
    fetchPhoto();
    return () => { cancelled = true; };
  }, [visitId, repId, customerId, scheduleDate]);

  if (!photoUrl) return null;

  return (
    <div className="shrink-0">
      <img src={photoUrl} alt="Visit photo" className="w-16 h-16 object-cover rounded-xl" style={{ border: `1px solid ${C.border}` }} />
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
}: {
  item: any;
  repId: string;
  scheduleDate: string;
  onRefresh: () => void;
  onLocalUpdate: (itemId: string, updates: any) => void;
  isExpanded: boolean;
  onToggle: () => void;
  index: number;
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

  const nowTime = () => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  };

  const calcDuration = (arr: string, lv: string) => {
    if (!arr || !lv) return 0;
    const [ah, am] = arr.split(":").map(Number);
    const [lh, lm] = lv.split(":").map(Number);
    return lh * 60 + lm - (ah * 60 + am);
  };

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
      blobToBase64(compressed).then((b64) => savePendingPhoto(item.id, b64)).catch(() => {});
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

  const uploadPhotoOnline = async (visitId: string): Promise<string | null> => {
    if (!photoBlob) return null;
    try {
      const path = `${repId}/${visitId}.jpg`;
      const { error } = await supabase.storage
        .from("visit-photos")
        .upload(path, photoBlob, { contentType: "image/jpeg", upsert: true });
      if (error) { console.warn("[Photo] Upload failed:", error.message); return null; }
      const { data: urlData } = supabase.storage.from("visit-photos").getPublicUrl(path);
      return urlData?.publicUrl || null;
    } catch {
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
            if (card?.scheduleItemId === item.id && card.visitId) patchVisitId = card.visitId;
          } catch { /* IDB unavailable */ }
        }

        if (patchVisitId) {
          // ── PATCH path: visit was already inserted at arrival ──
          const photoUrl = await uploadPhotoOnline(patchVisitId);
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
          const photoUrl = await uploadPhotoOnline(item.visit_id);
          if (photoUrl)
            await supabase.from("visits").update({ photo_url: photoUrl } as any).eq("id", item.visit_id);
        } else {
          // ── Insert path: no prior visit row exists ──
          const insertPayload = { rep_id: repId, customer_id: item.customer_id, visit_date: scheduleDate, ...checkoutData };
          console.log("[Schedule] inserting visit payload:", JSON.stringify(insertPayload));
          const { data: visit, error: insertErr } = await supabase
            .from("visits")
            .insert(insertPayload as any)
            .select("id")
            .single();
          console.log("[Schedule] visit insert response:", { data: visit, error: insertErr ? { code: insertErr.code, message: insertErr.message, details: insertErr.details, hint: insertErr.hint } : null });
          if (insertErr) console.error("[Schedule] visit insert FAILED:", insertErr.code, insertErr.message, insertErr.details, insertErr.hint);
          if (visit) {
            await supabase.from("schedule_items").update({ visit_id: visit.id }).eq("id", item.id);
            const photoUrl = await uploadPhotoOnline(visit.id);
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
      await queueScheduleItemUpdate(newItem);
      if (!activeVisitId) await handleOfflineVisitSave(newItem);
    } finally {
      setActionInProgress(false);
      if (newItem.status === "visited" || newItem.status === "skipped") {
        clearPendingPhoto(item.id).catch(() => {});
        clearActiveCard().catch(() => {});
      }
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
            const photoUrl = await uploadPhotoOnline(data.id);
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

  const skipItem = async () => {
    if (actionInProgress) return;
    if (!localNotes.trim()) { toast.error("Please provide a reason in the notes before skipping"); return; }
    setActionInProgress(true);
    const skippedUpdates = { arrival_time: null, leaving_time: null, duration_minutes: 0, notes: localNotes, status: "skipped" };
    onLocalUpdate(item.id, skippedUpdates);
    try {
      if (!navigator.onLine) {
        await queueScheduleItemUpdate(skippedUpdates);
        await saveVisitOffline(repId, item.customer_id, scheduleDate, "00:00", "00:00", 0, localNotes, item.customers?.customer_name, "skipped");
        toast.success("Saved offline. Will sync when online.");
        return;
      }
      const { error } = await supabase.from("schedule_items").update({ status: "skipped", notes: localNotes }).eq("id", item.id);
      if (error) {
        if (isOfflineError(error)) {
          await queueScheduleItemUpdate(skippedUpdates);
          await saveVisitOffline(repId, item.customer_id, scheduleDate, "00:00", "00:00", 0, localNotes, item.customers?.customer_name, "skipped");
          toast.success("Saved offline. Will sync when online.");
          return;
        }
        toast.error(error.message); return;
      }
      await supabase.from("visits").insert({ rep_id: repId, customer_id: item.customer_id, visit_date: scheduleDate, arrival_time: "00:00", leaving_time: "00:00", duration_minutes: 0, notes: localNotes, status: "skipped" } as any);
      onRefresh();
    } catch (err: any) {
      console.warn("[Schedule] Network error on skip:", err?.message);
      try {
        await queueScheduleItemUpdate(skippedUpdates);
        await saveVisitOffline(repId, item.customer_id, scheduleDate, "00:00", "00:00", 0, localNotes, item.customers?.customer_name, "skipped");
        toast.success("Saved offline. Will sync when online.");
      } catch (idbErr) {
        console.error("[Schedule] IndexedDB save failed:", idbErr);
        toast.error("Failed to save. Please try again.");
      }
    } finally {
      setActionInProgress(false);
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
      className="w-full flex items-center gap-3 px-4 py-3 text-left"
      style={{ background: "transparent" }}
    >
      {/* index badge */}
      <span
        className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold font-syne"
        style={{
          background: item.status === "visited" ? C.greenLight :
                      item.status === "skipped" ? C.redBg :
                      isInProgress ? C.orangeBg : C.border,
          color: item.status === "visited" ? "#fff" :
                 item.status === "skipped" ? C.red :
                 isInProgress ? C.orange : C.textMuted,
        }}
      >
        {index + 1}
      </span>

      {/* name */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate font-syne" style={{ color: C.text }}>{customerName}</p>
        {accountNum && <p className="text-[11px]" style={{ color: C.textMuted }}>#{accountNum}</p>}
      </div>

      {/* status pill */}
      <StatusPill status={item.status} isInProgress={!!isInProgress} />

      {/* expand chevron */}
      <span style={{ color: C.textMuted }}>
        {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </span>
    </button>
  );

  if (!isExpanded) {
    return (
      <div
        id={`card-${item.id}`}
        className="rounded-2xl overflow-hidden"
        style={{ background: C.card, border: `1px solid ${C.border}` }}
      >
        {collapsedRow}
      </div>
    );
  }

  // ── expanded body ──
  return (
    <div
      id={`card-${item.id}`}
      className="rounded-2xl overflow-hidden"
      style={{ background: C.card, border: `1.5px solid ${isInProgress ? C.orange : item.status === "visited" ? C.greenLight : C.border}` }}
    >
      {collapsedRow}

      <div className="px-4 pb-4 space-y-3" style={{ borderTop: `1px solid ${C.border}` }}>
        {/* visited / skipped summary */}
        {item.status === "visited" && (
          <div className="pt-3">
            <div className="flex gap-3 items-start">
              {/* Left side: all text details */}
              <div className="flex-1 space-y-1.5">
                {/* Times and duration */}
                {item.arrival_time && item.leaving_time && (
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-medium" style={{ color: C.textMuted }}>In:</span>
                      <span className="text-sm font-medium" style={{ color: C.text }}>{item.arrival_time?.slice(0, 5)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-medium" style={{ color: C.textMuted }}>Out:</span>
                      <span className="text-sm font-medium" style={{ color: C.text }}>{item.leaving_time?.slice(0, 5)}</span>
                    </div>
                    {item.duration_minutes > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-medium" style={{ color: C.textMuted }}>Dur:</span>
                        <span className="text-sm font-medium" style={{ color: C.text }}>{item.duration_minutes}m</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Order details — rendered inline from VisitDetailsText */}
                <VisitDetailsText visitId={item.visit_id} repId={repId} customerId={item.customer_id} scheduleDate={scheduleDate} />

                {/* Notes */}
                {item.notes && (
                  <p className="text-xs italic" style={{ color: C.textMuted }}>"{item.notes}"</p>
                )}

                {/* Edit Order section */}
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
                    className="text-xs font-medium mt-2 px-3 py-1.5 rounded-lg"
                    style={{ color: C.green, border: `1px solid ${C.border}`, background: C.bg }}
                  >
                    <Pencil size={11} className="inline mr-1" /> Edit Order
                  </button>
                )}

                {editingDone && (
                  <div className="mt-2 space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[10px] font-medium" style={{ color: C.textMuted }}>Order No.</label>
                        <Input value={doneOrderNumber} onChange={(e) => setDoneOrderNumber(e.target.value)}
                          onBlur={resetMobileZoom}
                          className="h-8 text-sm" style={{ borderColor: C.border, background: C.bg }} placeholder="Order #" />
                      </div>
                      <div>
                        <label className="text-[10px] font-medium" style={{ color: C.textMuted }}>Qty</label>
                        <Input type="number" min="0" step="1" value={doneOrderQty} onChange={(e) => setDoneOrderQty(e.target.value)}
                          onBlur={resetMobileZoom}
                          className="h-8 text-sm" style={{ borderColor: C.border, background: C.bg }} placeholder="0" />
                      </div>
                      <div>
                        <label className="text-[10px] font-medium" style={{ color: C.textMuted }}>Amount</label>
                        <Input type="number" min="0" step="0.01" value={doneOrderAmount} onChange={(e) => setDoneOrderAmount(e.target.value)}
                          onBlur={resetMobileZoom}
                          className="h-8 text-sm" style={{ borderColor: C.border, background: C.bg }} placeholder="0.00" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingDone(false)}
                        className="text-xs px-3 py-1.5 rounded-lg"
                        style={{ color: C.textMuted, border: `1px solid ${C.border}` }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={saveDoneOrder}
                        disabled={actionInProgress}
                        className="text-xs px-3 py-1.5 rounded-lg font-medium"
                        style={{ background: C.green, color: "#fff" }}
                      >
                        {actionInProgress ? "Saving..." : "Update"}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Right side: photo thumbnail */}
              <VisitPhotoOnly visitId={item.visit_id} repId={repId} customerId={item.customer_id} scheduleDate={scheduleDate} />
            </div>
          </div>
        )}

        {item.status === "skipped" && (
          <div className="pt-3">
            {item.notes && <p className="text-sm italic" style={{ color: C.textMuted }}>Reason: "{item.notes}"</p>}
          </div>
        )}

        {/* pending / in-progress form */}
        {item.status === "pending" && (
          <div className="pt-3 space-y-3">
            {/* time row */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs" style={{ color: C.textMuted }}>Arrival</Label>
                <div className="flex gap-1">
                  <Input
                    type="time"
                    value={localArrival}
                    onChange={(e) => setLocalArrival(e.target.value)}
                    onBlur={() => { commitArrival(); resetMobileZoom(); }}
                    className="h-9 text-sm time-input-clean"
                    style={{ borderColor: C.border, background: C.bg }}
                  />
                  <Button type="button" variant="outline" size="sm" className="h-9 px-2 shrink-0"
                    onClick={markArrived} style={{ borderColor: C.border }}>
                    <Clock size={13} />
                  </Button>
                </div>
              </div>
              <div>
                <Label className="text-xs" style={{ color: C.textMuted }}>Leaving</Label>
                <div className="flex gap-1">
                  <Input
                    type="time"
                    value={localLeaving}
                    onChange={(e) => setLocalLeaving(e.target.value)}
                    onBlur={() => { commitLeaving(); resetMobileZoom(); }}
                    className="h-9 text-sm time-input-clean"
                    style={{ borderColor: C.border, background: C.bg }}
                  />
                  <Button type="button" variant="outline" size="sm" className="h-9 px-2 shrink-0"
                    onClick={markLeft} style={{ borderColor: C.border }}>
                    <Clock size={13} />
                  </Button>
                </div>
              </div>
            </div>

            {/* duration */}
            {localArrival && localLeaving && calcDuration(localArrival, localLeaving) > 0 && (
              <p className="text-xs" style={{ color: C.textMuted }}>
                Duration: {calcDuration(localArrival, localLeaving)} min
              </p>
            )}

            {/* photo */}
            {localArrival && (
              <div>
                {photoPreview ? (
                  <div className="relative inline-block">
                    <img src={photoPreview} alt="Store photo" className="h-20 w-20 object-cover rounded-xl" style={{ border: `1px solid ${C.border}` }} />
                    <button type="button" onClick={clearPhoto}
                      className="absolute -top-1 -right-1 rounded-full p-0.5"
                      style={{ background: C.red, color: "#fff" }}>
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <CameraCapture onCapture={handleCameraCapture} triggerClassName="h-8 text-xs" />
                )}
              </div>
            )}

            {/* order fields */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs" style={{ color: C.textMuted }}>Order No.</Label>
                <Input
                  value={localOrderNumber}
                  onChange={(e) => setLocalOrderNumber(e.target.value)}
                  onBlur={resetMobileZoom}
                  className="h-9 text-sm"
                  style={{ borderColor: C.border, background: C.bg }}
                  placeholder="Order #"
                />
              </div>
              <div>
                <Label className="text-xs" style={{ color: C.textMuted }}>Qty</Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={localOrderQty}
                  onChange={(e) => setLocalOrderQty(e.target.value)}
                  onBlur={resetMobileZoom}
                  className="h-9 text-sm"
                  style={{ borderColor: C.border, background: C.bg }}
                  placeholder="0"
                />
              </div>
              <div>
                <Label className="text-xs" style={{ color: C.textMuted }}>Amount</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={localOrderAmount}
                  onChange={(e) => setLocalOrderAmount(e.target.value)}
                  onBlur={resetMobileZoom}
                  className="h-9 text-sm"
                  style={{ borderColor: C.border, background: C.bg }}
                  placeholder="0.00"
                />
              </div>
            </div>

            {/* notes */}
            <div>
              <Label className="text-xs" style={{ color: C.textMuted }}>Notes</Label>
              <Textarea
                placeholder="Notes (required to skip)..."
                value={localNotes}
                onChange={(e) => setLocalNotes(e.target.value)}
                onBlur={() => { commitNotes(); resetMobileZoom(); }}
                rows={2}
                className="text-sm resize-none"
                style={{ borderColor: C.border, background: C.bg }}
              />
            </div>

            {/* actions */}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={skipItem}
                disabled={actionInProgress}
                className="text-xs h-8"
                style={{ borderColor: C.border, color: C.textMuted }}
              >
                <SkipForward size={12} className="mr-1" /> Skip
              </Button>
              {localArrival && localLeaving && calcDuration(localArrival, localLeaving) > 0 && (
                <Button
                  size="sm"
                  onClick={markVisited}
                  disabled={actionInProgress}
                  className="text-xs h-8 flex-1"
                  style={actionInProgress ? {
                    background: `linear-gradient(90deg, ${C.green} 25%, ${C.greenMid} 50%, ${C.green} 75%)`,
                    backgroundSize: "200% 100%",
                    animationName: "btn-shimmer",
                    animationDuration: "1.2s",
                    animationIterationCount: "infinite",
                    animationTimingFunction: "linear",
                    color: "#fff",
                  } : { background: C.green, color: "#fff" }}
                >
                  <Check size={12} className="mr-1" /> Mark Visited
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DailySchedule ────────────────────────────────────────────────────────────

export default function DailySchedule() {
  const { repId } = useAuth();
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
  const validationRanRef = useRef<string | null>(null);

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
        setItems((data.schedule_items || []).sort((a: any, b: any) => a.sort_order - b.sort_order));
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
            setItems((newData?.schedule_items || []).sort((a: any, b: any) => a.sort_order - b.sort_order));
            if (newData) await setCachedSchedule(repId, scheduleDate, newData);
          } else {
            setSchedule(null); setItems([]);
          }
        } else {
          // Future date with no existing schedule — leave it ungenerated
          setSchedule(null); setItems([]);
        }
      }
    } catch (err) {
      console.warn("[Schedule] Online refresh failed, keeping cached schedule if available", err);
      if (!hasCachedSchedule) { setSchedule(null); setItems([]); }
    } finally {
      setLoading(false);
    }
  };

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
      if (data) setUnscheduledVisits(data);
    } catch {
      // network error — keep existing state
    }
  }, [repId, scheduleDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch unscheduled visits whenever scheduled items change (a new visit_id may appear)
  useEffect(() => {
    fetchUnscheduledVisits();
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

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

        console.log(`[ScheduleValidation] Stale template detected and corrected for ${scheduleDate}`);

        // Step 7: refresh so the UI shows the new items
        fetchSchedule();
      } catch {
        // Offline or unexpected error — fail silently, never surface to the rep
      }
    })();
  }, [schedule?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const nowTime = () => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  };

  const calcDuration = (arr: string, lv: string) => {
    if (!arr || !lv) return 0;
    const [ah, am] = arr.split(":").map(Number);
    const [lh, lm] = lv.split(":").map(Number);
    return lh * 60 + lm - (ah * 60 + am);
  };

  const submitAdHoc = async () => {
    if (!repId || !adHocCustomerId || !adHocArrival || !adHocLeaving) return;
    const dur = calcDuration(adHocArrival, adHocLeaving);
    if (dur <= 0) { toast.error("Leaving must be after arrival"); return; }
    setAdHocSubmitting(true);
    const customerName = adHocCustomers.find((c) => c.id === adHocCustomerId)?.customer_name;
    try {
      const { error } = await supabase.from("visits").insert({
        rep_id: repId, customer_id: adHocCustomerId, visit_date: scheduleDate,
        arrival_time: adHocArrival, leaving_time: adHocLeaving, duration_minutes: dur, notes: adHocNotes || null,
        order_number: adHocOrderNumber || null,
        order_quantity: adHocOrderQty !== "" ? Number(adHocOrderQty) : null,
        order_amount: adHocOrderAmount !== "" ? Number(adHocOrderAmount) : null,
      });
      if (error) {
        if (isOfflineError(error)) {
          await saveVisitOffline(repId, adHocCustomerId, scheduleDate, adHocArrival, adHocLeaving, dur, adHocNotes || null, customerName, undefined, null, adHocOrderNumber || null, adHocOrderQty !== "" ? Number(adHocOrderQty) : null, adHocOrderAmount !== "" ? Number(adHocOrderAmount) : null);
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
        await saveVisitOffline(repId, adHocCustomerId, scheduleDate, adHocArrival, adHocLeaving, dur, adHocNotes || null, customerName, undefined, null, adHocOrderNumber || null, adHocOrderQty !== "" ? Number(adHocOrderQty) : null, adHocOrderAmount !== "" ? Number(adHocOrderAmount) : null);
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

  // Read dismissed flag from localStorage whenever date or rep changes
  useEffect(() => {
    setSummaryDismissed(dismissedKey ? localStorage.getItem(dismissedKey) === "1" : false);
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
    : displayDate.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  // ─── render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="schedule-screen flex flex-col -mx-4 -mt-6 -mb-6"
      style={{ background: C.bg, minHeight: "calc(100dvh - 56px)" }}
    >
      {/* offline banner */}
      {!isOnline && <OfflineBanner />}

      {/* header */}
      <div className="px-4 pt-5 pb-3" style={{ background: C.header }}>
        {/* date navigation */}
        <div className="flex items-center justify-between mb-1">
          <button
            type="button"
            onClick={() => changeDay(-1)}
            className="w-8 h-8 flex items-center justify-center rounded-full"
            style={{ background: "rgba(255,255,255,0.1)", color: "#fff" }}
          >
            <ChevronLeft size={18} />
          </button>

          <div className="text-center">
            <p className="font-syne font-bold text-lg leading-tight" style={{ color: "#fff" }}>{dateLabel}</p>
            {currentWeekName && (
              <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.6)" }}>{currentWeekName}</p>
            )}
          </div>

          <button
            type="button"
            onClick={() => changeDay(1)}
            className="w-8 h-8 flex items-center justify-center rounded-full"
            style={{ background: "rgba(255,255,255,0.1)", color: "#fff" }}
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* stats strip */}
        {!loading && !generating && items.length > 0 && (
          <div className="flex items-center justify-center gap-6 mt-3 mb-2">
            <div className="text-center">
              <p className="font-syne font-bold text-2xl leading-none" style={{ color: C.greenLight }}>{visitedCount}</p>
              <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.55)" }}>Done</p>
            </div>
            <div className="text-center">
              <p className="font-syne font-bold text-2xl leading-none" style={{ color: "#fff" }}>{activeItems.length}</p>
              <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.55)" }}>Remaining</p>
            </div>
            <div className="text-center">
              <p className="font-syne font-bold text-2xl leading-none" style={{ color: "rgba(255,255,255,0.7)" }}>{totalCount}</p>
              <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.55)" }}>Total</p>
            </div>
          </div>
        )}

        {/* progress bar */}
        {items.length > 0 && (
          <div className="h-[3px] rounded-full mt-2" style={{ background: "rgba(255,255,255,0.15)" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progress * 100}%`, background: C.greenLight }}
            />
          </div>
        )}
      </div>

      {/* tab bar */}
      {!loading && !generating && schedule && (
        <div className="flex px-4 pt-3 gap-2">
          {(["active", "done"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className="flex-1 py-2 rounded-xl text-sm font-semibold font-syne transition-colors"
              style={{
                background: activeTab === tab ? C.green : C.card,
                color: activeTab === tab ? "#fff" : C.textMuted,
                border: `1px solid ${activeTab === tab ? C.green : C.border}`,
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
          activeItems.length === 0 ? (
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
              />
            ))
          )
        ) : (
          completedItems.length === 0 && unscheduledVisits.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2" style={{ color: C.textMuted }}>
              <p className="text-sm">No completed visits yet</p>
            </div>
          ) : (
            <>
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
          <div className="pt-2">

            {/* collapsed: two cards sitting side by side */}
            {expandedBottomCard === null && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setExpandedBottomCard("unscheduled")}
                  className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-2xl text-sm font-medium min-w-0"
                  style={{ background: C.card, border: `1.5px dashed ${C.border}`, color: C.textMuted }}
                >
                  <Plus size={15} className="shrink-0" />
                  <span className="truncate">Unscheduled</span>
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedBottomCard("offroute")}
                  className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-2xl text-sm font-medium min-w-0"
                  style={{ background: C.card, border: `1.5px dashed ${C.border}`, color: C.textMuted }}
                >
                  <Plus size={15} className="shrink-0" />
                  <span className="truncate">Off-Route Order</span>
                </button>
              </div>
            )}

            {/* expanded: unscheduled visit form */}
            {expandedBottomCard === "unscheduled" && (
              <div className="rounded-2xl p-4 space-y-3" style={{ background: C.card, border: `1.5px solid ${C.border}` }}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold font-syne" style={{ color: C.text }}>Unscheduled Visit</p>
                  <button type="button" onClick={resetAdHoc} style={{ color: C.textMuted }}><X size={16} /></button>
                </div>

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

                <Button
                  onClick={submitAdHoc}
                  disabled={adHocSubmitting || !adHocCustomerId || !adHocArrival || !adHocLeaving}
                  className="w-full h-10 font-syne font-semibold"
                  style={adHocSubmitting ? {
                    background: `linear-gradient(90deg, ${C.green} 25%, ${C.greenMid} 50%, ${C.green} 75%)`,
                    backgroundSize: "200% 100%",
                    animationName: "btn-shimmer",
                    animationDuration: "1.2s",
                    animationIterationCount: "infinite",
                    animationTimingFunction: "linear",
                    color: "#fff",
                  } : { background: C.green, color: "#fff" }}
                >
                  Log Visit
                </Button>
              </div>
            )}

            {/* expanded: off-route order form */}
            {expandedBottomCard === "offroute" && (
              <div className="rounded-2xl p-4 space-y-3" style={{ background: C.card, border: `1.5px solid ${C.border}` }}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold font-syne" style={{ color: C.text }}>Off-Route Order</p>
                  <button type="button" onClick={resetOffRoute} style={{ color: C.textMuted }}><X size={16} /></button>
                </div>

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

                <Button
                  onClick={submitOffRoute}
                  disabled={offRouteSubmitting || !offRouteCustomerId}
                  className="w-full h-10 font-syne font-semibold"
                  style={offRouteSubmitting ? {
                    background: `linear-gradient(90deg, ${C.green} 25%, ${C.greenMid} 50%, ${C.green} 75%)`,
                    backgroundSize: "200% 100%",
                    animationName: "btn-shimmer",
                    animationDuration: "1.2s",
                    animationIterationCount: "infinite",
                    animationTimingFunction: "linear",
                    color: "#fff",
                  } : { background: C.green, color: "#fff" }}
                >
                  Log Order
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
