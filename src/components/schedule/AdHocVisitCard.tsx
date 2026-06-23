import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Check, X, MapPin, Camera, FileText, Search, Pin } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { compressImage, blobToBase64 } from "@/lib/imageCompressor";
import { CameraCapture } from "@/components/CameraCapture";
import { Button } from "@/components/ui/button";
import { addOfflineVisit, savePendingPhoto, saveAdHocCard, getAdHocCard, clearAdHocCard } from "@/lib/offlineDb";
import { C, isOfflineError, saveVisitOffline, nowTime, calcDuration, resetMobileZoom, Expand } from "./ScheduleHelpers";

export interface Customer {
  id: string;
  customer_name: string;
  account_number?: string | null;
  area?: string | null;
  is_active?: boolean;
}

export interface SyntheticVisit {
  id: string;
  customer_id: string;
  customers: { customer_name: string };
  status: "visited";
  arrival_time: string;
  leaving_time: string;
  duration_minutes: number;
  notes: string | null;
  order_number: string | null;
  order_quantity: number | null;
  order_amount: number | null;
  photo_url: null;
  _offline: true;
}

export function AdHocVisitCard({
  repId,
  scheduleDate,
  adHocCustomers,
  onComplete,
  onCancel,
}: {
  repId: string;
  scheduleDate: string;
  adHocCustomers: Customer[];
  onComplete: (syntheticVisit: SyntheticVisit | null) => void;
  onCancel: () => void;
}) {
  const [adHocCustomerId, setAdHocCustomerId] = useState("");
  const [adHocNotes, setAdHocNotes] = useState("");
  const [adHocOrderNumber, setAdHocOrderNumber] = useState("");
  const [adHocOrderQty, setAdHocOrderQty] = useState("");
  const [adHocOrderAmount, setAdHocOrderAmount] = useState("");
  const [adHocSubmitting, setAdHocSubmitting] = useState(false);
  const [adHocPhoto, setAdHocPhoto] = useState<{ blob: Blob; preview: string } | null>(null);
  const [adHocCheckedIn, setAdHocCheckedIn] = useState(false);
  const [adHocArrivalTime, setAdHocArrivalTime] = useState("");
  const [adHocShowNotes, setAdHocShowNotes] = useState(false);
  const [adHocSearch, setAdHocSearch] = useState("");
  const [adHocSearchOpen, setAdHocSearchOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const saved = await getAdHocCard();
        if (!saved) return;
        setAdHocCustomerId(saved.customerId);
        setAdHocArrivalTime(saved.arrivalTime);
        setAdHocCheckedIn(true);
        setAdHocNotes(saved.notes);
        setAdHocOrderNumber(saved.orderNumber);
        setAdHocOrderQty(saved.orderQty);
        setAdHocOrderAmount(saved.orderAmount);
      } catch { /* IDB unavailable — start fresh */ }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!adHocCheckedIn || !adHocCustomerId || !adHocArrivalTime) return;
    saveAdHocCard({
      customerId: adHocCustomerId,
      arrivalTime: adHocArrivalTime,
      notes: adHocNotes,
      orderNumber: adHocOrderNumber,
      orderQty: adHocOrderQty,
      orderAmount: adHocOrderAmount,
    }).catch(() => {});
  }, [adHocCheckedIn, adHocCustomerId, adHocArrivalTime, adHocNotes, adHocOrderNumber, adHocOrderQty, adHocOrderAmount]); // eslint-disable-line react-hooks/exhaustive-deps

  const uploadAdHocPhoto = async (repId: string, visitId: string, clientGeneratedId: string, blob: Blob): Promise<string | null> => {
    const queuePhoto = async () => {
      try {
        const b64 = await blobToBase64(blob);
        await savePendingPhoto(visitId, b64, visitId, clientGeneratedId);
        toast.warning("Photo saved for upload — will retry when connection improves");
      } catch { /* IDB write failure must not block checkout */ }
    };
    try {
      const path = `${repId}/${visitId}.jpg`;
      const { error } = await supabase.storage
        .from("visit-photos")
        .upload(path, blob, { contentType: "image/jpeg", upsert: true });
      if (error) {
        console.warn("[AdHoc] Photo upload failed:", error.message);
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

  const submitAdHoc = async () => {
    if (!repId || !adHocCustomerId || !adHocArrivalTime) return;
    const adHocLeavingTime = nowTime();
    const dur = calcDuration(adHocArrivalTime, adHocLeavingTime);
    if (dur <= 0) { toast.error("Unable to calculate duration. Please try again."); return; }
    setAdHocSubmitting(true);
    const adHocClientId = uuidv4();
    const customerName = adHocCustomers.find((c) => c.id === adHocCustomerId)?.customer_name;

    try {
      const { data: insertedVisit, error } = await supabase.from("visits").insert({
        rep_id: repId, customer_id: adHocCustomerId, visit_date: scheduleDate,
        arrival_time: adHocArrivalTime, leaving_time: adHocLeavingTime, duration_minutes: dur, notes: adHocNotes || null,
        status: "visited",
        client_generated_id: adHocClientId,
        order_number: adHocOrderNumber || null,
        order_quantity: adHocOrderQty !== "" ? Number(adHocOrderQty) : null,
        order_amount: adHocOrderAmount !== "" ? Number(adHocOrderAmount) : null,
      } as any).select("id").single();
      if (error) {
        if (isOfflineError(error)) {
          const photoB64 = adHocPhoto ? await blobToBase64(adHocPhoto.blob) : null;
          await saveVisitOffline(repId, adHocCustomerId, scheduleDate, adHocArrivalTime, adHocLeavingTime, dur, adHocNotes || null, customerName, "visited", photoB64, adHocOrderNumber || null, adHocOrderQty !== "" ? Number(adHocOrderQty) : null, adHocOrderAmount !== "" ? Number(adHocOrderAmount) : null);
          toast.success("Saved offline. Will sync when online.");
          onComplete({
            id: adHocClientId,
            customer_id: adHocCustomerId,
            customers: { customer_name: customerName ?? "Unknown" },
            status: "visited",
            arrival_time: adHocArrivalTime,
            leaving_time: adHocLeavingTime,
            duration_minutes: dur,
            notes: adHocNotes || null,
            order_number: adHocOrderNumber || null,
            order_quantity: adHocOrderQty !== "" ? Number(adHocOrderQty) : null,
            order_amount: adHocOrderAmount !== "" ? Number(adHocOrderAmount) : null,
            photo_url: null,
            _offline: true,
          });
          resetAdHoc();
        } else {
          toast.error(error.message);
        }
      } else {
        if (adHocPhoto && insertedVisit?.id) {
          const photoUrl = await uploadAdHocPhoto(repId, insertedVisit.id, adHocClientId, adHocPhoto.blob);
          if (photoUrl) {
            await supabase.from("visits").update({ photo_url: photoUrl } as any).eq("id", insertedVisit.id);
          }
        }
        toast.success("Ad-hoc visit logged");
        onComplete(null);
        resetAdHoc();
      }
    } catch (err: any) {
      console.warn("[Schedule] Network error on ad-hoc:", err?.message);
      try {
        const photoB64 = adHocPhoto ? await blobToBase64(adHocPhoto.blob) : null;
        await saveVisitOffline(repId, adHocCustomerId, scheduleDate, adHocArrivalTime, adHocLeavingTime, dur, adHocNotes || null, customerName, "visited", photoB64, adHocOrderNumber || null, adHocOrderQty !== "" ? Number(adHocOrderQty) : null, adHocOrderAmount !== "" ? Number(adHocOrderAmount) : null);
        toast.success("Saved offline. Will sync when online.");
        onComplete({
          id: adHocClientId,
          customer_id: adHocCustomerId,
          customers: { customer_name: customerName ?? "Unknown" },
          status: "visited",
          arrival_time: adHocArrivalTime,
          leaving_time: adHocLeavingTime,
          duration_minutes: dur,
          notes: adHocNotes || null,
          order_number: adHocOrderNumber || null,
          order_quantity: adHocOrderQty !== "" ? Number(adHocOrderQty) : null,
          order_amount: adHocOrderAmount !== "" ? Number(adHocOrderAmount) : null,
          photo_url: null,
          _offline: true,
        });
        resetAdHoc();
      } catch (idbErr) {
        console.error("[Schedule] IndexedDB save failed:", idbErr);
        toast.error("Failed to save visit. Please try again.");
      }
    }
    clearAdHocCard().catch(() => {});
    setAdHocSubmitting(false);
  };

  const resetAdHoc = () => {
    clearAdHocCard().catch(() => {});
    onCancel();
    setAdHocCustomerId(""); setAdHocNotes("");
    setAdHocOrderNumber(""); setAdHocOrderQty(""); setAdHocOrderAmount("");
    setAdHocCheckedIn(false);
    setAdHocArrivalTime("");
    setAdHocShowNotes(false);
    setAdHocSearch("");
    setAdHocSearchOpen(false);
    if (adHocPhoto) URL.revokeObjectURL(adHocPhoto.preview);
    setAdHocPhoto(null);
  };

  return (
    <div style={{ borderRadius: 22, overflow: "hidden", background: C.surface, border: `1.5px solid ${C.greenSoft}` }}>
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

      <Expand open={true}>
        {adHocCheckedIn === false ? (
          // STATE A: Not checked in
          <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Customer section */}
            <div>
              {adHocCustomerId ? (
                // Customer is selected: show styled card
                (() => {
                  const customer = adHocCustomers.find(c => c.id === adHocCustomerId);
                  return customer ? (
                    <div style={{ background: C.cream, borderRadius: 14, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, border: `1px solid ${C.border}` }}>
                      <div style={{ width: 32, height: 32, borderRadius: 10, background: C.green, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                        {customer.customer_name.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 13, color: C.ink, lineHeight: 1.2 }}>{customer.customer_name}</div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: C.inkMute, marginTop: 2 }}>{customer.account_number}</div>
                      </div>
                      <button type="button" onClick={() => setAdHocCustomerId("")} style={{ background: "none", border: "none", color: C.inkMute, cursor: "pointer", padding: 0 }}>
                        <X size={14} />
                      </button>
                    </div>
                  ) : null;
                })()
              ) : adHocSearchOpen ? (
                // Search is open: show inline search+list with close button
                <div style={{ background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${C.border}` }}>
                    <Search size={14} style={{ color: C.inkMute, flexShrink: 0 }} />
                    <input
                      type="text"
                      value={adHocSearch}
                      onChange={(e) => setAdHocSearch(e.target.value)}
                      placeholder="Search customer..."
                      style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: C.ink }}
                    />
                    <button type="button" onClick={() => { setAdHocSearchOpen(false); setAdHocSearch(""); }}
                      style={{ background: "none", border: "none", color: C.inkMute, cursor: "pointer", padding: 0, flexShrink: 0 }}>
                      <X size={14} />
                    </button>
                  </div>
                  <div style={{ maxHeight: 200, overflowY: "auto" }}>
                    {[...adHocCustomers]
                      .filter(c => c.customer_name.toLowerCase().includes(adHocSearch.toLowerCase()))
                      .sort((a, b) => a.customer_name.localeCompare(b.customer_name))
                      .map(c => (
                        <button key={c.id} type="button" onClick={() => { setAdHocCustomerId(c.id); setAdHocSearch(""); setAdHocSearchOpen(false); }}
                          style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "none", border: "none", borderBottom: `1px solid ${C.border}`, cursor: "pointer", textAlign: "left" }}>
                          <div style={{ width: 28, height: 28, borderRadius: 8, background: C.greenSoft, color: C.green, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>
                            {c.customer_name.charAt(0).toUpperCase()}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13, color: C.ink }}>{c.customer_name}</div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: C.inkMute }}>{c.area || c.account_number || ""}</div>
                          </div>
                        </button>
                      ))}
                  </div>
                </div>
              ) : (
                // Search is closed: show collapsed search pill
                <button type="button" onClick={() => setAdHocSearchOpen(true)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 14, border: `1px solid ${C.border}`, background: C.surface, cursor: "pointer" }}>
                  <Search size={14} style={{ color: C.inkMute, flexShrink: 0 }} />
                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: C.inkMute }}>Search customer...</span>
                </button>
              )}
            </div>

            {/* Tap to check in button */}
            <button type="button" onClick={() => { const t = nowTime(); setAdHocArrivalTime(t); setAdHocCheckedIn(true); }}
              disabled={!adHocCustomerId}
              style={{ width: "100%", height: 56, borderRadius: 18, border: "none", cursor: adHocCustomerId ? "pointer" : "not-allowed", background: adHocCustomerId ? `linear-gradient(180deg, ${C.greenMid} 0%, ${C.green} 100%)` : C.cream, color: adHocCustomerId ? "#fff" : C.inkMute, fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: 0.2, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, boxShadow: adHocCustomerId ? `0 12px 24px -10px ${C.green}88` : "none" }}>
              <MapPin size={18} /> Tap to check in
            </button>

            {/* Cancel button */}
            <Button
              type="button"
              onClick={resetAdHoc}
              className="w-full h-11 font-syne font-semibold"
              style={{ background: "transparent", color: C.inkSoft, border: `1px solid ${C.border}` }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          // STATE B: Checked in
          <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Customer card - always shown when checked in */}
            {(() => {
              const customer = adHocCustomers.find(c => c.id === adHocCustomerId);
              return customer ? (
                <div style={{ background: C.cream, borderRadius: 14, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, border: `1px solid ${C.border}` }}>
                  <div style={{ width: 32, height: 32, borderRadius: 10, background: C.green, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                    {customer.customer_name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 13, color: C.ink, lineHeight: 1.2 }}>{customer.customer_name}</div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: C.inkMute, marginTop: 2 }}>{customer.account_number}</div>
                  </div>
                </div>
              ) : null;
            })()}

            {/* Stepper pills row - Done card style */}
            <div style={{ background: C.cream, borderRadius: 14, padding: "6px", display: "flex", gap: 4 }}>
              {[
                { label: "ARRIVED", value: adHocArrivalTime ? adHocArrivalTime.slice(0, 5) : null },
                { label: "PHOTO", value: adHocPhoto ? "✓" : null },
                { label: "ORDER", value: adHocOrderNumber ? "✓" : null },
                { label: "LEFT", value: null },
              ].map(({ label, value }) => (
                <div key={label} style={{ flex: 1, background: C.surface, borderRadius: 999, padding: "7px 4px", textAlign: "center" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: C.inkMute, fontFamily: "'DM Sans', sans-serif" }}>{label}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: value ? C.ink : C.inkMute, fontFamily: "'Syne', sans-serif", marginTop: 3, opacity: value ? 1 : 0.3 }}>{value ?? "—"}</div>
                </div>
              ))}
            </div>

            {/* Photo + Notes toggle buttons */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <CameraCapture
                onCapture={async (blob) => {
                  try {
                    const compressed = await compressImage(blob);
                    const preview = URL.createObjectURL(compressed);
                    setAdHocPhoto({ blob: compressed, preview });
                  } catch {
                    toast.error("Failed to process photo");
                  }
                }}
                buttonStyle={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  height: 44, borderRadius: 14, cursor: "pointer",
                  background: adHocPhoto ? C.greenInk : C.cream,
                  color: adHocPhoto ? "#fff" : C.inkSoft,
                  border: "none", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13, width: "100%",
                }}
                buttonLabel={<><Camera size={15} /> {adHocPhoto ? "Photo ready" : "Take photo"}</>}
              />
              <button type="button" onClick={() => setAdHocShowNotes(v => !v)}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: 14, cursor: "pointer", background: C.cream, color: C.inkSoft, border: "none", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13 }}>
                <FileText size={15} /> Add note
              </button>
            </div>

            {/* Notes textarea - shown if adHocShowNotes */}
            {adHocShowNotes && (
              <div style={{ marginBottom: 0 }}>
                <textarea
                  value={adHocNotes}
                  onChange={(e) => setAdHocNotes(e.target.value)}
                  onBlur={resetMobileZoom}
                  placeholder="Add a note…"
                  rows={3}
                  style={{ width: "100%", resize: "none", border: `1px solid ${C.border}`, borderRadius: 12, outline: "none", background: C.surface, fontFamily: "'DM Sans', sans-serif", fontSize: 13.5, color: C.ink, lineHeight: 1.45, padding: "10px 12px", boxSizing: "border-box" }}
                />
              </div>
            )}

            {/* Order fields */}
            <div style={{ background: C.cream, borderRadius: 16, padding: 12 }}>
              <div style={{ fontSize: 10.5, color: C.inkMute, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 600, fontFamily: "'DM Sans', sans-serif", marginBottom: 8 }}>
                Order
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1.3fr 0.6fr 1fr", gap: 8 }}>
                <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                  <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>№</div>
                  <input value={adHocOrderNumber} onChange={(e) => setAdHocOrderNumber(e.target.value)}
                    onBlur={resetMobileZoom}
                    type="text" placeholder="Order #" inputMode="numeric" style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }} />
                </label>
                <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                  <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>QTY</div>
                  <input type="number" min="0" step="1" value={adHocOrderQty} onChange={(e) => setAdHocOrderQty(e.target.value)}
                    onBlur={resetMobileZoom}
                    placeholder="0" inputMode="numeric" style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }} />
                </label>
                <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                  <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>VALUE</div>
                  <input type="number" min="0" step="0.01" value={adHocOrderAmount} onChange={(e) => setAdHocOrderAmount(e.target.value)}
                    onBlur={resetMobileZoom}
                    placeholder="0.00" inputMode="decimal" style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }} />
                </label>
              </div>
            </div>

            {/* Tap to check out button */}
            <button type="button" onClick={() => { submitAdHoc(); }}
              disabled={adHocSubmitting}
              style={{ width: "100%", height: 60, borderRadius: 18, border: "none", cursor: "pointer", background: `linear-gradient(180deg, ${C.greenMid} 0%, ${C.green} 100%)`, color: "#fff", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 17, letterSpacing: 0.3, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, boxShadow: `0 12px 28px -10px ${C.green}aa, 0 1px 0 rgba(255,255,255,0.2) inset, 0 -1px 0 ${C.greenDeep}88 inset`, marginBottom: 6, opacity: adHocSubmitting ? 0.7 : 1 }}>
              <Check size={20} /> Tap to check out
            </button>

            {/* Cancel button */}
            <Button
              type="button"
              onClick={resetAdHoc}
              className="w-full h-11 font-syne font-semibold"
              style={{ background: "transparent", color: C.inkSoft, border: `1px solid ${C.border}` }}
            >
              Cancel
            </Button>
          </div>
        )}
      </Expand>
    </div>
  );
}
