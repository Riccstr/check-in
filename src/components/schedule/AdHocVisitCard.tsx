import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Check, X, MapPin, Camera, FileText, Search, Pin } from "lucide-react";
import { compressImage, blobToBase64 } from "@/lib/imageCompressor";
import { CameraCapture } from "@/components/CameraCapture";
import { Button } from "@/components/ui/button";
import { C, resetMobileZoom, Expand } from "./ScheduleHelpers";
import {
  startVisit, checkOut, updateDraft,
} from "@/lib/visitMachine";
import { syncVisitEvents } from "@/lib/syncEngine";
import type { ActiveVisit } from "@/lib/offlineDb";

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
  photo_url: string | null;
  _offline: true;
}

export function AdHocVisitCard({
  repId,
  scheduleDate,
  adHocCustomers,
  activeVisit,
  setActiveVisit,
  onComplete,
  onCancel,
}: {
  repId: string;
  scheduleDate: string;
  adHocCustomers: Customer[];
  activeVisit: ActiveVisit | null;
  setActiveVisit: (v: ActiveVisit | null) => void;
  onComplete: (syntheticVisit: SyntheticVisit | null) => void;
  onCancel: () => void;
}) {
  // Pre-check-in local state (customer selection only)
  const [adHocCustomerId, setAdHocCustomerId] = useState("");
  const [adHocSearch, setAdHocSearch] = useState("");
  const [adHocSearchOpen, setAdHocSearchOpen] = useState(false);

  // Post-check-in local input mirrors (seeded from the active ad-hoc visit)
  const [draftNotes, setDraftNotes] = useState("");
  const [draftOrderNumber, setDraftOrderNumber] = useState("");
  const [draftOrderQty, setDraftOrderQty] = useState("");
  const [draftOrderAmount, setDraftOrderAmount] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [busy, setBusy] = useState(false);

  // This card's active visit is the one the page holds IF it's an ad-hoc visit.
  const adHocActive = activeVisit && activeVisit.kind === "adhoc" ? activeVisit : null;
  const checkedIn = !!adHocActive;

  // Seed local mirrors when the ad-hoc active visit appears / changes.
  const activeKey = adHocActive ? adHocActive.clientId : null;
  useEffect(() => {
    if (adHocActive) {
      setDraftNotes(adHocActive.notes || "");
      setDraftOrderNumber(adHocActive.orderNumber || "");
      setDraftOrderQty(adHocActive.orderQty || "");
      setDraftOrderAmount(adHocActive.orderAmount || "");
    } else {
      setDraftNotes(""); setDraftOrderNumber(""); setDraftOrderQty(""); setDraftOrderAmount("");
      setShowNotes(false);
    }
  }, [activeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const photoPreview = adHocActive?.photoBase64 ?? null;
  const hasPhoto = !!photoPreview;

  const selectedCustomer =
    (checkedIn
      ? adHocCustomers.find((c) => c.id === adHocActive!.customerId)
      : adHocCustomers.find((c) => c.id === adHocCustomerId)) || null;

  // ── draft push helpers ──
  const pushDraft = async (fields: { notes?: string; orderNumber?: string; orderQty?: string; orderAmount?: string }) => {
    const next = await updateDraft(fields);
    if (next) setActiveVisit(next);
  };
  const onNotes = (v: string) => { setDraftNotes(v); pushDraft({ notes: v }); };
  const onOrderNumber = (v: string) => { setDraftOrderNumber(v); pushDraft({ orderNumber: v }); };
  const onOrderQty = (v: string) => { setDraftOrderQty(v); pushDraft({ orderQty: v }); };
  const onOrderAmount = (v: string) => { setDraftOrderAmount(v); pushDraft({ orderAmount: v }); };

  // ── check in ──
  const handleCheckIn = async () => {
    if (!adHocCustomerId || busy) return;
    setBusy(true);
    try {
      const res = await startVisit({
        kind: "adhoc",
        repId,
        customerId: adHocCustomerId,
        customerName: adHocCustomers.find((c) => c.id === adHocCustomerId)?.customer_name ?? null,
        visitDate: scheduleDate,
        scheduleItemId: null,
      });
      if (!res.ok) {
        toast.error(`You have an open visit at ${res.openCustomerName ?? "another customer"}. Please check out first.`);
        return;
      }
      setActiveVisit(res.active);
      if (navigator.onLine) syncVisitEvents().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  // ── photo ──
  const handleCapture = async (blob: Blob) => {
    try {
      const compressed = await compressImage(blob);
      const b64 = await blobToBase64(compressed);
      const next = await updateDraft({ photoBase64: b64 });
      if (next) setActiveVisit(next);
    } catch {
      toast.error("Failed to process photo");
    }
  };

  // ── check out ──
  const handleCheckOut = async () => {
    if (busy || !adHocActive) return;
    setBusy(true);
    try {
      const res = await checkOut();
      if (!res.ok) {
        if (res.reason === "zero_duration") {
          toast.error("You just checked in. Add your photo and details, then check out.");
        } else {
          toast.error("No active visit to check out.");
        }
        return;
      }
      const customerName = selectedCustomer?.customer_name ?? "Unknown";
      // Optimistic synthetic row for the Done tab (page also refetches).
      onComplete({
        id: adHocActive.clientId,
        customer_id: adHocActive.customerId,
        customers: { customer_name: customerName },
        status: "visited",
        arrival_time: adHocActive.arrivalTime,
        leaving_time: "",
        duration_minutes: 0,
        notes: draftNotes || null,
        order_number: draftOrderNumber || null,
        order_quantity: draftOrderQty !== "" ? Number(draftOrderQty) : null,
        order_amount: null,
        photo_url: null,
        _offline: true,
      });
      setActiveVisit(null);
      resetLocal();
      if (navigator.onLine) syncVisitEvents().catch(() => {});
      else toast.success("Saved offline. Will sync when online.");
    } finally {
      setBusy(false);
    }
  };

  const resetLocal = () => {
    setAdHocCustomerId(""); setAdHocSearch(""); setAdHocSearchOpen(false);
    setDraftNotes(""); setDraftOrderNumber(""); setDraftOrderQty(""); setDraftOrderAmount("");
    setShowNotes(false);
  };

  // Cancel: if checked in, this abandons the in-progress ad-hoc visit.
  const handleCancel = async () => {
    if (checkedIn) {
      if (!confirm("Cancel this visit? Your check-in and any entered details will be lost.")) return;
      // Abandon the active visit without emitting completion.
      const { clearActiveVisit } = await import("@/lib/offlineDb");
      await clearActiveVisit().catch(() => {});
      setActiveVisit(null);
    }
    resetLocal();
    onCancel();
  };

  return (
    <div style={{ borderRadius: 22, overflow: "hidden", background: C.surface, border: `1.5px solid ${C.greenSoft}` }}>
      <div style={{ height: 3, background: `linear-gradient(90deg, ${C.greenMid} 0%, ${C.green} 100%)` }} />

      <div style={{ padding: "16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: C.greenSoft, display: "flex", alignItems: "center", justifyContent: "center", color: C.green }}>
            <Pin size={14} />
          </div>
          <div>
            <p style={{ fontFamily: "Syne, sans-serif", fontSize: 14, fontWeight: 600, color: C.ink, margin: 0 }}>Unscheduled visit</p>
            <p style={{ fontSize: 11, color: C.inkMute, margin: 0, marginTop: 2 }}>Add a customer visit off your route</p>
          </div>
        </div>
        <button type="button" onClick={handleCancel} style={{ background: "none", border: "none", color: C.inkMute, cursor: "pointer", padding: 0 }}>
          <X size={16} />
        </button>
      </div>

      <Expand open={true}>
        {!checkedIn ? (
          // STATE A: Not checked in
          <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              {adHocCustomerId ? (
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
                <div style={{ background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${C.border}` }}>
                    <Search size={14} style={{ color: C.inkMute, flexShrink: 0 }} />
                    <input type="text" value={adHocSearch} onChange={(e) => setAdHocSearch(e.target.value)} placeholder="Search customer..." style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: C.ink }} />
                    <button type="button" onClick={() => { setAdHocSearchOpen(false); setAdHocSearch(""); }} style={{ background: "none", border: "none", color: C.inkMute, cursor: "pointer", padding: 0, flexShrink: 0 }}>
                      <X size={14} />
                    </button>
                  </div>
                  <div style={{ maxHeight: 200, overflowY: "auto" }}>
                    {[...adHocCustomers]
                      .filter(c => c.customer_name.toLowerCase().includes(adHocSearch.toLowerCase()))
                      .sort((a, b) => a.customer_name.localeCompare(b.customer_name))
                      .map(c => (
                        <button key={c.id} type="button" onClick={() => { setAdHocCustomerId(c.id); setAdHocSearch(""); setAdHocSearchOpen(false); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "none", border: "none", borderBottom: `1px solid ${C.border}`, cursor: "pointer", textAlign: "left" }}>
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
                <button type="button" onClick={() => setAdHocSearchOpen(true)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 14, border: `1px solid ${C.border}`, background: C.surface, cursor: "pointer" }}>
                  <Search size={14} style={{ color: C.inkMute, flexShrink: 0 }} />
                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: C.inkMute }}>Search customer...</span>
                </button>
              )}
            </div>

            <button type="button" onClick={handleCheckIn} disabled={!adHocCustomerId || busy}
              style={{ width: "100%", height: 56, borderRadius: 18, border: "none", cursor: adHocCustomerId ? "pointer" : "not-allowed", background: adHocCustomerId ? `linear-gradient(180deg, ${C.greenMid} 0%, ${C.green} 100%)` : C.cream, color: adHocCustomerId ? "#fff" : C.inkMute, fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: 0.2, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, boxShadow: adHocCustomerId ? `0 12px 24px -10px ${C.green}88` : "none" }}>
              <MapPin size={18} /> Tap to check in
            </button>

            <Button type="button" onClick={handleCancel} className="w-full h-11 font-syne font-semibold" style={{ background: "transparent", color: C.inkSoft, border: `1px solid ${C.border}` }}>
              Cancel
            </Button>
          </div>
        ) : (
          // STATE B: Checked in
          <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>
            {selectedCustomer && (
              <div style={{ background: C.cream, borderRadius: 14, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, border: `1px solid ${C.border}` }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: C.green, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                  {selectedCustomer.customer_name.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 13, color: C.ink, lineHeight: 1.2 }}>{selectedCustomer.customer_name}</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: C.inkMute, marginTop: 2 }}>{selectedCustomer.account_number}</div>
                </div>
              </div>
            )}

            <div style={{ background: C.cream, borderRadius: 14, padding: "6px", display: "flex", gap: 4 }}>
              {[
                { label: "ARRIVED", value: adHocActive ? adHocActive.arrivalTime.slice(0, 5) : null },
                { label: "PHOTO", value: hasPhoto ? "✓" : null },
                { label: "ORDER", value: draftOrderNumber ? "✓" : null },
                { label: "LEFT", value: null },
              ].map(({ label, value }) => (
                <div key={label} style={{ flex: 1, background: C.surface, borderRadius: 999, padding: "7px 4px", textAlign: "center" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: C.inkMute, fontFamily: "'DM Sans', sans-serif" }}>{label}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: value ? C.ink : C.inkMute, fontFamily: "'Syne', sans-serif", marginTop: 3, opacity: value ? 1 : 0.3 }}>{value ?? "—"}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <CameraCapture
                onCapture={handleCapture}
                buttonStyle={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: 14, cursor: "pointer", background: hasPhoto ? C.greenInk : C.cream, color: hasPhoto ? "#fff" : C.inkSoft, border: "none", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13, width: "100%" }}
                buttonLabel={<><Camera size={15} /> {hasPhoto ? "Photo ready" : "Take photo"}</>}
              />
              <button type="button" onClick={() => setShowNotes(v => !v)} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: 14, cursor: "pointer", background: C.cream, color: C.inkSoft, border: "none", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13 }}>
                <FileText size={15} /> Add note
              </button>
            </div>

            {showNotes && (
              <div style={{ marginBottom: 0 }}>
                <textarea value={draftNotes} onChange={(e) => onNotes(e.target.value)} onBlur={resetMobileZoom} placeholder="Add a note…" rows={3} style={{ width: "100%", resize: "none", border: `1px solid ${C.border}`, borderRadius: 12, outline: "none", background: C.surface, fontFamily: "'DM Sans', sans-serif", fontSize: 13.5, color: C.ink, lineHeight: 1.45, padding: "10px 12px", boxSizing: "border-box" }} />
              </div>
            )}

            <div style={{ background: C.cream, borderRadius: 16, padding: 12 }}>
              <div style={{ fontSize: 10.5, color: C.inkMute, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 600, fontFamily: "'DM Sans', sans-serif", marginBottom: 8 }}>Order</div>
              <div style={{ display: "grid", gridTemplateColumns: "1.3fr 0.6fr 1fr", gap: 8 }}>
                <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                  <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>№</div>
                  <input value={draftOrderNumber} onChange={(e) => onOrderNumber(e.target.value)} onBlur={resetMobileZoom} type="text" placeholder="Order #" inputMode="numeric" style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }} />
                </label>
                <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                  <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>QTY</div>
                  <input type="number" min="0" step="1" value={draftOrderQty} onChange={(e) => onOrderQty(e.target.value)} onBlur={resetMobileZoom} placeholder="0" inputMode="numeric" style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }} />
                </label>
                <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                  <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>VALUE</div>
                  <input type="text" min="0" step="0.01" value={draftOrderAmount} onChange={(e) => onOrderAmount(e.target.value)} onBlur={resetMobileZoom} placeholder="0.00" inputMode="decimal" style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }} />
                </label>
              </div>
            </div>

            <button type="button" onClick={handleCheckOut} disabled={busy}
              style={{ width: "100%", height: 60, borderRadius: 18, border: "none", cursor: "pointer", background: `linear-gradient(180deg, ${C.greenMid} 0%, ${C.green} 100%)`, color: "#fff", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 17, letterSpacing: 0.3, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, boxShadow: `0 12px 28px -10px ${C.green}aa, 0 1px 0 rgba(255,255,255,0.2) inset, 0 -1px 0 ${C.greenDeep}88 inset`, marginBottom: 6, opacity: busy ? 0.7 : 1 }}>
              <Check size={20} /> {busy ? "Checking out…" : "Tap to check out"}
            </button>

            <Button type="button" onClick={handleCancel} className="w-full h-11 font-syne font-semibold" style={{ background: "transparent", color: C.inkSoft, border: `1px solid ${C.border}` }}>
              Cancel
            </Button>
          </div>
        )}
      </Expand>
    </div>
  );
}