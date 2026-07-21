import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Check, SkipForward, X, Pencil, Clock, Camera, FileText, Lock, MapPin, ChevronDown } from "lucide-react";
import { CameraCapture } from "@/components/CameraCapture";
import { C, resetMobileZoom, Expand } from "./ScheduleHelpers";
import { RippleButton, ShimmerButton } from "./Animations";
import type { ActiveVisit } from "@/lib/offlineDb";

// ─── ScheduleCard ─────────────────────────────────────────────────────────────
//
// Prop-driven. This component holds NO in-progress truth of its own — the open
// visit's state lives in `activeVisit` (owned by DailySchedule, backed by the
// active_visit IDB record). All mutations go through callbacks. The card reads,
// renders, and calls up; it never touches IDB, the outbox, or the visits table
// for the in-progress lifecycle. (It still does a direct read for the done-state
// "Edit details" prefill, which is a completed-visit lookup, not in-progress.)

export function ScheduleCard({
  item,
  repId,
  scheduleDate,
  activeVisit,
  isActiveStop,
  busy,
  onCheckIn,
  onCheckOut,
  onCapturePhoto,
  onClearPhoto,
  onUpdateDraft,
  onSkip,
  onEditCompleted,
  isExpanded,
  onToggle,
  index,
}: {
  item: any;
  repId: string;
  scheduleDate: string;
  // The single open visit, or null. This card is "active" only when
  // isActiveStop is true (activeVisit belongs to this card's customer).
  activeVisit: ActiveVisit | null;
  isActiveStop: boolean;
  // True while a machine transition for this card is in flight (check-in/out/skip).
  busy: boolean;
  onCheckIn: () => void;
  onCheckOut: () => void;
  onCapturePhoto: (blob: Blob) => void;
  onClearPhoto: () => void;
  onUpdateDraft: (fields: { notes?: string; orderNumber?: string; orderQty?: string; orderAmount?: string }) => void;
  onSkip: (reason: string) => void;
  onEditCompleted: (args: {
    clientId: string;
    arrivalTime: string | null;
    leavingTime: string | null;
    orderNumber: string;
    orderQty: string;
    orderAmount: string;
    notes: string | null;
  }) => Promise<void> | void;
  isExpanded: boolean;
  onToggle: () => void;
  index: number;
}) {
  // ── Local input mirrors (typing responsiveness only) ──
  // Seeded from activeVisit; reset whenever the active stop identity changes.
  // activeVisit remains the source of truth — these just hold live keystrokes,
  // pushed up via onUpdateDraft.
  const [draftNotes, setDraftNotes]       = useState("");
  const [draftOrderNumber, setDraftOrderNumber] = useState("");
  const [draftOrderQty, setDraftOrderQty]       = useState("");
  const [draftOrderAmount, setDraftOrderAmount] = useState("");
  const [showNotes, setShowNotes]         = useState(false);

  // Reseed local mirrors when this becomes (or stops being) the active stop,
  // or when the active visit's clientId changes (new visit started here).
  const activeKey = isActiveStop && activeVisit ? activeVisit.clientId : null;
  useEffect(() => {
    if (isActiveStop && activeVisit) {
      setDraftNotes(activeVisit.notes || "");
      setDraftOrderNumber(activeVisit.orderNumber || "");
      setDraftOrderQty(activeVisit.orderQty || "");
      setDraftOrderAmount(activeVisit.orderAmount || "");
    } else {
      setDraftNotes("");
      setDraftOrderNumber("");
      setDraftOrderQty("");
      setDraftOrderAmount("");
      setShowNotes(false);
    }
  }, [activeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Done-state edit ──
  const [editingDone, setEditingDone]         = useState(false);
  const [doneOrderNumber, setDoneOrderNumber] = useState("");
  const [doneOrderQty, setDoneOrderQty]       = useState("");
  const [doneOrderAmount, setDoneOrderAmount] = useState("");
  const [doneArrival, setDoneArrival]         = useState("");
  const [doneLeaving, setDoneLeaving]         = useState("");
  const [loadingDoneEdit, setLoadingDoneEdit] = useState(false);
  const [savingDone, setSavingDone]           = useState(false);

  // ── Skip composer ──
  const [skipMode, setSkipMode] = useState(false);
  const [skipNote, setSkipNote] = useState("");

  // Photo preview comes from the active visit's stored base64 (source of truth).
  const photoPreview =
    isActiveStop && activeVisit?.photoBase64 ? activeVisit.photoBase64 : null;
  const hasPhoto = !!photoPreview;

  // Arrival shown in the stepper: the active visit's arrival, or the persisted
  // item arrival (after a completed checkout the item carries it).
  const shownArrival = isActiveStop && activeVisit ? activeVisit.arrivalTime : (item.arrival_time || "");

  // In-progress = this is the active stop (device-owned open visit).
  const isInProgress = isActiveStop && !!activeVisit;

  const customerName = item.customers?.customer_name ?? "Unknown";
  const accountNum   = item.customers?.account_number;

  // ── draft push helpers (update local mirror + bubble up) ──
  const pushNotes = (v: string) => { setDraftNotes(v); onUpdateDraft({ notes: v }); };
  const pushOrderNumber = (v: string) => { setDraftOrderNumber(v); onUpdateDraft({ orderNumber: v }); };
  const pushOrderQty = (v: string) => { setDraftOrderQty(v); onUpdateDraft({ orderQty: v }); };
  const pushOrderAmount = (v: string) => { setDraftOrderAmount(v); onUpdateDraft({ orderAmount: v }); };

  const doSkip = (note: string) => {
    if (!note.trim()) { toast.error("Please provide a reason before skipping"); return; }
    onSkip(note);
    setSkipMode(false);
    setSkipNote("");
  };

  const openDoneEdit = async () => {
    if (loadingDoneEdit) return;
    setLoadingDoneEdit(true);
    try {
      let visitData: any = null;
      if (item.visit_id) {
        const res = await supabase
          .from("visits")
          .select("order_number, order_quantity, order_amount, client_generated_id")
          .eq("id", item.visit_id)
          .maybeSingle();
        visitData = res.data;
      }
      if (!visitData) {
        const res = await (supabase
          .from("visits")
          .select("order_number, order_quantity, order_amount, client_generated_id")
          .eq("rep_id", repId)
          .eq("customer_id", item.customer_id)
          .eq("visit_date", scheduleDate)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle() as any);
        visitData = res.data;
      }
      setDoneArrival(item.arrival_time ? item.arrival_time.slice(0, 5) : "");
      setDoneLeaving(item.leaving_time ? item.leaving_time.slice(0, 5) : "");
      setDoneOrderNumber(visitData?.order_number || "");
      setDoneOrderQty(visitData?.order_quantity != null ? String(visitData.order_quantity) : "");
      setDoneOrderAmount(visitData?.order_amount != null ? String(visitData.order_amount) : "");
      // stash the clientId for the edit event
      setDoneClientId(visitData?.client_generated_id ?? null);
      setEditingDone(true);
    } finally {
      setLoadingDoneEdit(false);
    }
  };

  const [doneClientId, setDoneClientId] = useState<string | null>(null);

  const saveDoneEdit = async () => {
    if (savingDone) return;
    if (!doneClientId) { toast.error("Visit reference not found — cannot edit"); return; }
    if (doneArrival && doneLeaving) {
      const [ah, am] = doneArrival.split(":").map(Number);
      const [lh, lm] = doneLeaving.split(":").map(Number);
      const dur = (lh * 60 + lm) - (ah * 60 + am);
      if (dur <= 0) { toast.error("Leaving time must be after arrival time"); return; }
    }
    setSavingDone(true);
    try {
      await onEditCompleted({
        clientId: doneClientId,
        arrivalTime: doneArrival || null,
        leavingTime: doneLeaving || null,
        orderNumber: doneOrderNumber,
        orderQty: doneOrderQty,
        orderAmount: doneOrderAmount,
        notes: null,
      });
      toast.success("Details updated");
      setEditingDone(false);
    } finally {
      setSavingDone(false);
    }
  };

  // ── collapsed row ──
  const collapsedRow = (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-4 px-5 py-4 text-left"
      style={{ background: "transparent", position: "relative" }}
    >
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

      <div className="flex-1 min-w-0">
        <p className="font-syne font-600 text-base" style={{ color: C.ink, letterSpacing: "-0.2px", lineHeight: 1.1 }}>{customerName}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span
            className="inline-flex items-center gap-1 text-[11px] font-semibold"
            style={{
              color: item.status === "visited" ? C.green :
                     item.status === "skipped" ? C.danger :
                     isInProgress ? C.sun : C.inkSoft,
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            <span style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: item.status === "visited" ? C.green :
                          item.status === "skipped" ? C.danger :
                          isInProgress ? C.sun : C.inkSoft,
              display: "inline-block",
              flexShrink: 0,
            }} />
            {item.status === "visited" ? "Visited" :
             item.status === "skipped" ? "Skipped" :
             isInProgress ? "In Progress" : item.status}
          </span>
          <span className="text-[11px]" style={{ color: C.inkMute, fontFamily: "'DM Sans', sans-serif" }}>· {accountNum || "—"}</span>
          {item.status === "visited" && item.duration_minutes > 0 && (
            <span className="text-[11px] font-semibold inline-flex items-center gap-1" style={{ color: C.inkSoft, fontFamily: "'DM Sans', sans-serif" }}>
              · <Clock size={11} /> {item.duration_minutes}m
            </span>
          )}
          {item.status === "visited" && (() => {
            const v = Array.isArray(item.visits) ? item.visits[0] : item.visits;
            if (!v?.order_amount) return null;
            return <span className="text-[11px]" style={{ color: C.inkMute, fontFamily: "'DM Sans', sans-serif" }}>· R {parseFloat(String(v.order_amount)).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
          })()}
        </div>
      </div>

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
            <div style={{ background: C.cream, borderRadius: 14, padding: "6px", display: "flex", gap: 4, marginBottom: 10 }}>
              {[
                { label: "ARRIVED", value: item.arrival_time ? item.arrival_time.slice(0, 5) : null },
                { label: "PHOTO", value: (Array.isArray(item.visits) ? item.visits[0]?.photo_url : item.visits?.photo_url) ? "✓" : null },
                { label: "ORDER", value: (Array.isArray(item.visits) ? item.visits[0]?.order_number : item.visits?.order_number) ? "✓" : null },
                { label: "LEFT", value: item.leaving_time ? item.leaving_time.slice(0, 5) : null },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  style={{
                    flex: 1,
                    background: value ? C.surface : C.cream,
                    borderRadius: 999,
                    padding: "12px 4px",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: C.inkMute, fontFamily: "'DM Sans', sans-serif" }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: value ? C.ink : C.inkMute, fontFamily: "'Syne', sans-serif", marginTop: 3, opacity: value ? 1 : 0.3 }}>
                    {value ?? "—"}
                  </div>
                </div>
              ))}
            </div>

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

              {(() => {
                const v = Array.isArray(item.visits) ? item.visits[0] : item.visits;
                if (!v?.order_number && v?.order_amount == null) return null;
                return (
                  <div style={{ background: C.surfaceAlt, borderRadius: 16, padding: "12px 14px" }}>
                    <div style={{ fontSize: 10.5, color: C.inkMute, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}>
                      Order {v.order_number}
                    </div>
                    <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, color: C.ink, fontWeight: 700, letterSpacing: "-0.4px", marginTop: 4, lineHeight: 1 }}>
                      R {parseFloat(String(v.order_amount || 0)).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11.5, color: C.inkSoft, marginTop: 4 }}>
                      {v.order_quantity} units
                    </div>
                  </div>
                );
              })()}
            </div>

            {!editingDone && (
              <ShimmerButton
                loading={loadingDoneEdit}
                disabled={loadingDoneEdit}
                loadingLabel={<><Pencil size={13} /> Loading…</>}
                idleStyle={{
                  width: "100%",
                  height: 38,
                  borderRadius: 12,
                  border: `1px solid ${C.border}`,
                  background: C.surface,
                  color: C.inkSoft,
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 600,
                  fontSize: 12.5,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
                onClick={openDoneEdit}
              >
                <Pencil size={13} /> Edit details
              </ShimmerButton>
            )}

            {editingDone && (
              <div style={{ background: C.cream, borderRadius: 16, padding: 12, marginBottom: 10, border: `1px solid ${C.border}` }}>
                <Expand open={editingDone}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 10.5, color: C.inkMute, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}>
                      Edit order
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                      <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>Arrived</div>
                      <input
                        type="time"
                        value={doneArrival}
                        onChange={(e) => setDoneArrival(e.target.value)}
                        onBlur={resetMobileZoom}
                        style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }}
                      />
                    </label>
                    <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                      <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>Left</div>
                      <input
                        type="time"
                        value={doneLeaving}
                        onChange={(e) => setDoneLeaving(e.target.value)}
                        onBlur={resetMobileZoom}
                        style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }}
                      />
                    </label>
                  </div>
                <div style={{ display: "grid", gridTemplateColumns: "1.3fr 0.6fr 1fr", gap: 8, marginBottom: 10 }}>
                  <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                    <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>№</div>
                    <input
                      type="text"
                      value={doneOrderNumber}
                      onChange={(e) => setDoneOrderNumber(e.target.value)}
                      onBlur={resetMobileZoom}
                      placeholder="PO-0000"
                      inputMode="numeric"
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
                      inputMode="numeric"
                      style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }}
                    />
                  </label>
                  <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                    <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>Value</div>
                    <input
                      type="text"
                      min="0"
                      step="0.01"
                      value={doneOrderAmount}
                      onChange={(e) => setDoneOrderAmount(e.target.value)}
                      onBlur={resetMobileZoom}
                      placeholder="R 0,00"
                      inputMode="decimal"
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
                    onClick={saveDoneEdit}
                    disabled={savingDone}
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
            <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px", background: C.cream, borderRadius: 999, marginBottom: 14 }}>
              <div style={{ flex: 1, textAlign: "center", padding: "7px 4px", borderRadius: 999, background: shownArrival ? C.surface : "transparent", boxShadow: shownArrival ? "0 2px 6px rgba(23,23,21,0.06)" : "none" }}>
                <div style={{ fontSize: 9.5, color: C.inkMute, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif", fontWeight: 700 }}>Arrived</div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: shownArrival ? C.greenInk : C.inkMute, marginTop: 1, fontWeight: 600 }}>
                  {shownArrival ? shownArrival.slice(0, 5) : "—"}
                </div>
              </div>
              <div style={{ flex: 1, textAlign: "center", padding: "7px 4px", borderRadius: 999, background: hasPhoto ? C.surface : "transparent", boxShadow: hasPhoto ? "0 2px 6px rgba(23,23,21,0.06)" : "none" }}>
                <div style={{ fontSize: 9.5, color: C.inkMute, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif", fontWeight: 700 }}>Photo</div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: hasPhoto ? C.greenInk : C.inkMute, marginTop: 1, fontWeight: 600 }}>
                  {hasPhoto ? "✓" : "—"}
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
              <>
                <RippleButton
                  onClick={onCheckIn}
                  disabled={busy}
                  style={{
                    width: "100%",
                    height: 56,
                    borderRadius: 18,
                    border: "none",
                    cursor: busy ? "not-allowed" : "pointer",
                    background: busy
                      ? `linear-gradient(180deg, ${C.inkSoft} 0%, ${C.inkSoft} 100%)`
                      : `linear-gradient(180deg, ${C.greenMid} 0%, ${C.green} 100%)`,
                    color: "#fff",
                    fontFamily: "'Syne', sans-serif",
                    fontWeight: 700,
                    fontSize: 16,
                    letterSpacing: 0.2,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    boxShadow: busy ? "none" : `0 12px 24px -10px ${C.green}88`,
                    marginBottom: 6,
                    opacity: busy ? 0.7 : 1,
                    transition: "background 200ms, opacity 200ms",
                  }}
                >
                  <MapPin size={18} /> {busy ? "Checking in…" : "Tap to check in"}
                </RippleButton>
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
              <Expand open={isInProgress}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                  <CameraCapture
                    onCapture={onCapturePhoto}
                    buttonStyle={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      height: 44,
                      borderRadius: 14,
                      cursor: "pointer",
                      background: hasPhoto ? C.greenInk : C.cream,
                      color: hasPhoto ? "#fff" : C.inkSoft,
                      border: "none",
                      fontFamily: "'DM Sans', sans-serif",
                      fontWeight: 600,
                      fontSize: 13,
                      width: "100%",
                    }}
                    buttonLabel={<><Camera size={15} /> {hasPhoto ? "Photo ready" : "Take photo"}</>}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNotes((v) => !v)}
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

                {showNotes && (
                  <div style={{ marginBottom: 12 }}>
                    <textarea
                      value={draftNotes}
                      onChange={(e) => pushNotes(e.target.value)}
                      onBlur={resetMobileZoom}
                      placeholder="Add a note…"
                      rows={3}
                      style={{
                        width: "100%",
                        resize: "none",
                        border: `1px solid ${C.border}`,
                        borderRadius: 12,
                        outline: "none",
                        background: C.surface,
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: 13.5,
                        color: C.ink,
                        lineHeight: 1.45,
                        padding: "10px 12px",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                )}

                <div style={{ background: C.cream, borderRadius: 16, padding: 12, marginBottom: 14 }}>
                  <div style={{ fontSize: 10.5, color: C.inkMute, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 600, fontFamily: "'DM Sans', sans-serif", marginBottom: 8 }}>
                    Order
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1.3fr 0.6fr 1fr", gap: 8 }}>
                    <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                      <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>№</div>
                      <input type="text" value={draftOrderNumber} onChange={(e) => pushOrderNumber(e.target.value)} onBlur={resetMobileZoom} placeholder="PO-0000" inputMode="numeric" style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }} />
                    </label>
                    <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                      <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>Qty</div>
                      <input type="number" min="0" step="1" value={draftOrderQty} onChange={(e) => pushOrderQty(e.target.value)} onBlur={resetMobileZoom} placeholder="0" inputMode="numeric" style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }} />
                    </label>
                    <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                      <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>Value</div>
                      <input type="text" min="0" step="0.01" value={draftOrderAmount} onChange={(e) => pushOrderAmount(e.target.value)} onBlur={resetMobileZoom} placeholder="R 0,00" inputMode="decimal" style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }} />
                    </label>
                  </div>
                </div>

                <RippleButton
                  onClick={onCheckOut}
                  disabled={busy}
                  style={{
                    width: "100%",
                    height: 60,
                    borderRadius: 18,
                    border: "none",
                    cursor: busy ? "not-allowed" : "pointer",
                    background: busy
                      ? `linear-gradient(180deg, ${C.inkSoft} 0%, ${C.inkSoft} 100%)`
                      : `linear-gradient(180deg, ${C.greenMid} 0%, ${C.green} 100%)`,
                    color: "#fff",
                    fontFamily: "'Syne', sans-serif",
                    fontWeight: 700,
                    fontSize: 17,
                    letterSpacing: 0.3,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    boxShadow: busy ? "none" : `0 12px 28px -10px ${C.green}aa, 0 1px 0 rgba(255,255,255,0.2) inset, 0 -1px 0 ${C.greenDeep}88 inset`,
                    marginBottom: 6,
                    opacity: busy ? 0.7 : 1,
                    transition: "background 200ms, opacity 200ms",
                  }}
                >
                  <Check size={20} /> {busy ? "Checking out…" : "Tap to check out"}
                </RippleButton>
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
              </Expand>
            )}
          </>
        )}

        {/* Skip composer */}
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
              onClick={() => doSkip(skipNote)}
              disabled={skipNote.trim().length < 3 || busy}
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