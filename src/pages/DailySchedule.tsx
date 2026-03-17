import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  CalendarDays, Clock, Check, SkipForward, Plus, Loader2, X,
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
} from "@/lib/offlineDb";

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

  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoBlob, setPhotoBlob]       = useState<Blob | null>(null);

  const notesRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setLocalNotes(item.notes || "");     }, [item.notes]);
  useEffect(() => { setLocalArrival(item.arrival_time || ""); }, [item.arrival_time]);
  useEffect(() => { setLocalLeaving(item.leaving_time || ""); }, [item.leaving_time]);

  // Auto-focus notes when card expands
  useEffect(() => {
    if (isExpanded && notesRef.current) {
      setTimeout(() => notesRef.current?.focus(), 200);
    }
  }, [isExpanded]);

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
    await upsertOfflineScheduleItemUpdate({
      schedule_item_id: item.id,
      rep_id: repId,
      schedule_date: scheduleDate,
      customer_id: item.customer_id,
      payload: {
        arrival_time: newItem.arrival_time || null,
        leaving_time: newItem.leaving_time || null,
        duration_minutes: newItem.duration_minutes ?? null,
        notes: newItem.notes || null,
        status: newItem.status || "pending",
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
    } catch {
      toast.error("Failed to process photo");
    }
  };

  const clearPhoto = () => {
    setPhotoBlob(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
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
        await handleOfflineVisitSave(newItem);
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
          await handleOfflineVisitSave(newItem);
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
        const visitData: any = {
          arrival_time: newItem.arrival_time,
          leaving_time: newItem.leaving_time,
          duration_minutes: newItem.duration_minutes,
          notes: newItem.notes || null,
          order_number: newItem.order_number ?? null,
          order_quantity: newItem.order_quantity ?? null,
          order_amount: newItem.order_amount ?? null,
        };

        if (item.visit_id) {
          await supabase.from("visits").update(visitData).eq("id", item.visit_id);
          const photoUrl = await uploadPhotoOnline(item.visit_id);
          if (photoUrl)
            await supabase.from("visits").update({ photo_url: photoUrl } as any).eq("id", item.visit_id);
        } else {
          const { data: visit } = await supabase
            .from("visits")
            .insert({ rep_id: repId, customer_id: item.customer_id, visit_date: scheduleDate, ...visitData } as any)
            .select("id")
            .single();
          if (visit) {
            await supabase.from("schedule_items").update({ visit_id: visit.id }).eq("id", item.id);
            const photoUrl = await uploadPhotoOnline(visit.id);
            if (photoUrl)
              await supabase.from("visits").update({ photo_url: photoUrl } as any).eq("id", visit.id);
          }
        }
      }
      onRefresh();
    } catch (err: any) {
      console.warn("[Schedule] Network error on update:", err?.message);
      await queueScheduleItemUpdate(newItem);
      await handleOfflineVisitSave(newItem);
    } finally {
      setActionInProgress(false);
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

  const commitNotes   = () => { if (localNotes   !== (item.notes        || "")) updateItem({ notes:        localNotes   }); };
  const commitArrival = () => { if (localArrival !== (item.arrival_time || "")) updateItem({ arrival_time: localArrival }); };
  const commitLeaving = () => { if (localLeaving !== (item.leaving_time || "")) updateItem({ leaving_time: localLeaving }); };

  const markArrived = () => { const t = nowTime(); setLocalArrival(t); updateItem({ arrival_time: t }); };
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
      className="rounded-2xl overflow-hidden"
      style={{ background: C.card, border: `1.5px solid ${isInProgress ? C.orange : item.status === "visited" ? C.greenLight : C.border}` }}
    >
      {collapsedRow}

      <div className="px-4 pb-4 space-y-3" style={{ borderTop: `1px solid ${C.border}` }}>
        {/* visited / skipped summary */}
        {item.status === "visited" && (
          <div className="pt-3 space-y-1">
            {item.arrival_time && item.leaving_time && (
              <p className="text-sm" style={{ color: C.textMuted }}>
                <Clock size={12} className="inline mr-1" />
                {item.arrival_time} → {item.leaving_time}
                {item.duration_minutes > 0 && ` · ${item.duration_minutes} min`}
              </p>
            )}
            {item.notes && <p className="text-sm italic" style={{ color: C.textMuted }}>"{item.notes}"</p>}
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
                <label className="text-xs font-medium mb-1 block" style={{ color: C.textMuted }}>Arrival</label>
                <div className="flex gap-1">
                  <Input
                    type="time"
                    value={localArrival}
                    onChange={(e) => setLocalArrival(e.target.value)}
                    onBlur={commitArrival}
                    className="h-9 text-sm time-input-clean"
                    style={{ borderColor: C.border, background: C.bg }}
                  />
                  {!localArrival && (
                    <Button size="sm" variant="outline" className="h-9 px-2 shrink-0 text-xs" onClick={markArrived}
                      style={{ borderColor: C.border, color: C.green }}>
                      Now
                    </Button>
                  )}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: C.textMuted }}>Leaving</label>
                <div className="flex gap-1">
                  <Input
                    type="time"
                    value={localLeaving}
                    onChange={(e) => setLocalLeaving(e.target.value)}
                    onBlur={commitLeaving}
                    className="h-9 text-sm time-input-clean"
                    style={{ borderColor: C.border, background: C.bg }}
                  />
                  {localArrival && !localLeaving && (
                    <Button size="sm" variant="outline" className="h-9 px-2 shrink-0 text-xs" onClick={markLeft}
                      style={{ borderColor: C.border, color: C.green }}>
                      Now
                    </Button>
                  )}
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

            {/* notes + order fields */}
            <div className="flex gap-2 items-stretch">
              <Textarea
                ref={notesRef}
                placeholder="Notes (required to skip)..."
                value={localNotes}
                onChange={(e) => setLocalNotes(e.target.value)}
                onBlur={commitNotes}
                rows={2}
                className="text-sm resize-none"
                style={{ borderColor: C.border, background: C.bg, flex: "0 0 58%" }}
              />
              <div className="flex flex-col justify-between flex-1">
                <Input
                  type="text"
                  placeholder="Order No."
                  value={localOrderNumber}
                  onChange={(e) => setLocalOrderNumber(e.target.value)}
                  className="h-8 text-sm"
                  style={{ borderColor: C.border, background: C.bg }}
                />
                <Input
                  type="number"
                  placeholder="Qty"
                  value={localOrderQty}
                  onChange={(e) => setLocalOrderQty(e.target.value)}
                  min="0"
                  step="1"
                  className="h-8 text-sm"
                  style={{ borderColor: C.border, background: C.bg }}
                />
                <Input
                  type="number"
                  placeholder="Amount"
                  value={localOrderAmount}
                  onChange={(e) => setLocalOrderAmount(e.target.value)}
                  min="0"
                  step="0.01"
                  className="h-8 text-sm"
                  style={{ borderColor: C.border, background: C.bg }}
                />
              </div>
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
                  style={{ background: C.green, color: "#fff" }}
                >
                  {actionInProgress ? <Loader2 size={12} className="animate-spin" /> : <><Check size={12} className="mr-1" /> Mark Visited</>}
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

  // accordion state
  const [expandedActiveId,    setExpandedActiveId]    = useState<string | null>(null);
  const [openCompletedId,     setOpenCompletedId]     = useState<string | null>(null);
  const [activeTab,           setActiveTab]           = useState<"active" | "done">("active");

  // ad-hoc visit state
  const [adHocOpen,        setAdHocOpen]        = useState(false);
  const [adHocCustomers,   setAdHocCustomers]   = useState<any[]>([]);
  const [adHocCustomerId,  setAdHocCustomerId]  = useState("");
  const [adHocArrival,     setAdHocArrival]     = useState("");
  const [adHocLeaving,     setAdHocLeaving]     = useState("");
  const [adHocNotes,       setAdHocNotes]       = useState("");
  const [adHocSubmitting,  setAdHocSubmitting]  = useState(false);

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
      .on("postgres_changes", { event: "*", schema: "public", table: "schedule_items", filter: `schedule_id=eq.${schedule.id}` }, () => { fetchSchedule(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [schedule?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!repId) return;
    const channel = supabase
      .channel(`daily-schedules-${repId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_schedules", filter: `rep_id=eq.${repId}` }, () => { fetchSchedule(); })
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
      }
    } catch (err) {
      console.warn("[Schedule] Online refresh failed, keeping cached schedule if available", err);
      if (!hasCachedSchedule) { setSchedule(null); setItems([]); }
    } finally {
      setLoading(false);
    }
  };

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
      });
      if (error) {
        if (isOfflineError(error)) {
          await saveVisitOffline(repId, adHocCustomerId, scheduleDate, adHocArrival, adHocLeaving, dur, adHocNotes || null, customerName);
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
        await saveVisitOffline(repId, adHocCustomerId, scheduleDate, adHocArrival, adHocLeaving, dur, adHocNotes || null, customerName);
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
    setAdHocOpen(false);
    setAdHocCustomerId(""); setAdHocArrival(""); setAdHocLeaving(""); setAdHocNotes("");
  };

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
  const isToday = scheduleDate === new Date().toISOString().split("T")[0];
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
                : `Done${completedItems.length > 0 ? ` (${completedItems.length})` : ""}`}
            </button>
          ))}
        </div>
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
            <p className="text-sm">No schedule for this date</p>
          </div>
        ) : activeTab === "active" ? (
          activeItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2" style={{ color: C.textMuted }}>
              <Check size={40} style={{ color: C.greenLight, opacity: 0.7 }} />
              <p className="text-sm font-semibold font-syne">All visits done!</p>
            </div>
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
          completedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2" style={{ color: C.textMuted }}>
              <p className="text-sm">No completed visits yet</p>
            </div>
          ) : (
            completedItems.map((item, i) => (
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
            ))
          )
        )}

        {/* ad-hoc visit section */}
        {schedule && (
          <div className="pt-2">
            {!adHocOpen ? (
              <button
                type="button"
                onClick={() => setAdHocOpen(true)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-medium"
                style={{ background: C.card, border: `1.5px dashed ${C.border}`, color: C.textMuted }}
              >
                <Plus size={16} /> Log Unscheduled Visit
              </button>
            ) : (
              <div className="rounded-2xl p-4 space-y-3" style={{ background: C.card, border: `1.5px solid ${C.border}` }}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold font-syne" style={{ color: C.text }}>Unscheduled Visit</p>
                  <button type="button" onClick={resetAdHoc} style={{ color: C.textMuted }}><X size={16} /></button>
                </div>

                <div>
                  <Label className="text-xs" style={{ color: C.textMuted }}>Customer</Label>
                  <Select value={adHocCustomerId} onValueChange={setAdHocCustomerId}>
                    <SelectTrigger style={{ borderColor: C.border, background: C.bg }}>
                      <SelectValue placeholder="Select customer" />
                    </SelectTrigger>
                    <SelectContent>
                      {adHocCustomers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.customer_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs" style={{ color: C.textMuted }}>Arrival</Label>
                    <div className="flex gap-1">
                      <Input type="time" value={adHocArrival} onChange={(e) => setAdHocArrival(e.target.value)}
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
                        className="h-9 text-sm time-input-clean" style={{ borderColor: C.border, background: C.bg }} />
                      <Button type="button" variant="outline" size="sm" className="h-9 px-2 shrink-0"
                        onClick={() => setAdHocLeaving(nowTime())} style={{ borderColor: C.border }}>
                        <Clock size={13} />
                      </Button>
                    </div>
                  </div>
                </div>

                <div>
                  <Label className="text-xs" style={{ color: C.textMuted }}>Notes</Label>
                  <Textarea value={adHocNotes} onChange={(e) => setAdHocNotes(e.target.value)} rows={2}
                    className="text-sm resize-none" style={{ borderColor: C.border, background: C.bg }} />
                </div>

                <Button
                  onClick={submitAdHoc}
                  disabled={adHocSubmitting || !adHocCustomerId || !adHocArrival || !adHocLeaving}
                  className="w-full h-10 font-syne font-semibold"
                  style={{ background: C.green, color: "#fff" }}
                >
                  {adHocSubmitting ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
                  Log Visit
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
