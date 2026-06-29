import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { X, Plus, Search } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { addOfflineVisit, saveOffRouteCard, getOffRouteCard, clearOffRouteCard } from "@/lib/offlineDb";
import { C, isOfflineError, resetMobileZoom, Expand, parseAmount } from "./ScheduleHelpers";
import type { Customer } from "./AdHocVisitCard";

export interface SyntheticOffRouteVisit {
  id: string;
  customer_id: string;
  customers: { customer_name: string };
  status: "off_route";
  arrival_time: null;
  leaving_time: null;
  duration_minutes: null;
  notes: string | null;
  order_number: string | null;
  order_quantity: number | null;
  order_amount: number | null;
  photo_url: null;
  _offline: true;
}

export function OffRouteOrderCard({
  repId,
  scheduleDate,
  adHocCustomers,
  onComplete,
  onRefresh,
  onCancel,
}: {
  repId: string;
  scheduleDate: string;
  adHocCustomers: Customer[];
  onComplete: (syntheticVisit: SyntheticOffRouteVisit | null) => void;
  onRefresh: () => void;
  onCancel: () => void;
}) {
  const [offRouteCustomerId, setOffRouteCustomerId] = useState("");
  const [offRouteOrderNumber, setOffRouteOrderNumber] = useState("");
  const [offRouteOrderQty, setOffRouteOrderQty] = useState("");
  const [offRouteOrderAmount, setOffRouteOrderAmount] = useState("");
  const [offRouteNotes, setOffRouteNotes] = useState("");
  const [offRouteSubmitting, setOffRouteSubmitting] = useState(false);
  const [offRouteSearchOpen, setOffRouteSearchOpen] = useState(false);
  const [offRouteSearch, setOffRouteSearch] = useState("");

  const submittingRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const saved = await getOffRouteCard();
        if (!saved) return;
        setOffRouteCustomerId(saved.customerId);
        setOffRouteOrderNumber(saved.orderNumber);
        setOffRouteOrderQty(saved.orderQty);
        setOffRouteOrderAmount(saved.orderAmount);
        setOffRouteNotes(saved.notes);
      } catch { /* IDB unavailable — start fresh */ }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!offRouteCustomerId) return;
    saveOffRouteCard({
      customerId: offRouteCustomerId,
      orderNumber: offRouteOrderNumber,
      orderQty: offRouteOrderQty,
      orderAmount: offRouteOrderAmount,
      notes: offRouteNotes,
    }).catch(() => {});
  }, [offRouteCustomerId, offRouteOrderNumber, offRouteOrderQty, offRouteOrderAmount, offRouteNotes]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitOffRoute = async () => {
    if (submittingRef.current) return;
    if (!repId || !offRouteCustomerId) { toast.error("Please select a customer"); return; }
    submittingRef.current = true;
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
      order_amount: parseAmount(offRouteOrderAmount),
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
            onComplete({
              id: clientId,
              customer_id: offRouteCustomerId,
              customers: { customer_name: adHocCustomers?.find((c: any) => c.id === offRouteCustomerId)?.customer_name ?? "Unknown" },
              status: "off_route",
              arrival_time: null,
              leaving_time: null,
              duration_minutes: null,
              notes: offRouteNotes || null,
              order_number: offRouteOrderNumber || null,
              order_quantity: offRouteOrderQty !== "" ? Number(offRouteOrderQty) : null,
              order_amount: parseAmount(offRouteOrderAmount),
              photo_url: null,
              _offline: true,
            });
          } else {
            toast.error(error.message);
            setOffRouteSubmitting(false);
            return;
          }
        } else {
          toast.success("Off-route order logged");
          onComplete({
            id: clientId,
            customer_id: offRouteCustomerId,
            customers: { customer_name: adHocCustomers?.find((c: any) => c.id === offRouteCustomerId)?.customer_name ?? "Unknown" },
            status: "off_route",
            arrival_time: null,
            leaving_time: null,
            duration_minutes: null,
            notes: offRouteNotes || null,
            order_number: offRouteOrderNumber || null,
            order_quantity: offRouteOrderQty !== "" ? Number(offRouteOrderQty) : null,
            order_amount: parseAmount(offRouteOrderAmount),
            photo_url: null,
            _offline: true,
          });
        }
      } else {
        await saveOffline();
        toast.success("Saved offline. Will sync when online.");
        onComplete({
          id: clientId,
          customer_id: offRouteCustomerId,
          customers: { customer_name: adHocCustomers?.find((c: any) => c.id === offRouteCustomerId)?.customer_name ?? "Unknown" },
          status: "off_route",
          arrival_time: null,
          leaving_time: null,
          duration_minutes: null,
          notes: offRouteNotes || null,
          order_number: offRouteOrderNumber || null,
          order_quantity: offRouteOrderQty !== "" ? Number(offRouteOrderQty) : null,
          order_amount: parseAmount(offRouteOrderAmount),
          photo_url: null,
          _offline: true,
        });
      }
      resetOffRoute();
      onRefresh();
    } catch (err: any) {
      console.warn("[Schedule] Network error on off-route:", err?.message);
      try {
        await saveOffline();
        toast.success("Saved offline. Will sync when online.");
        onComplete({
          id: clientId,
          customer_id: offRouteCustomerId,
          customers: { customer_name: adHocCustomers?.find((c: any) => c.id === offRouteCustomerId)?.customer_name ?? "Unknown" },
          status: "off_route",
          arrival_time: null,
          leaving_time: null,
          duration_minutes: null,
          notes: offRouteNotes || null,
          order_number: offRouteOrderNumber || null,
          order_quantity: offRouteOrderQty !== "" ? Number(offRouteOrderQty) : null,
          order_amount: parseAmount(offRouteOrderAmount),
          photo_url: null,
          _offline: true,
        });
        resetOffRoute();
      } catch {
        toast.error("Failed to save. Please try again.");
      }
    } finally {
      clearOffRouteCard().catch(() => {});
      submittingRef.current = false;
      setOffRouteSubmitting(false);
    }
  };

  const resetOffRoute = () => {
    clearOffRouteCard().catch(() => {});
    onCancel();
    setOffRouteCustomerId(""); setOffRouteOrderNumber(""); setOffRouteOrderQty("");
    setOffRouteOrderAmount(""); setOffRouteNotes("");
    setOffRouteSearchOpen(false); setOffRouteSearch("");
  };

  return (
    <div style={{ borderRadius: 22, overflow: "hidden", background: C.surface, border: `1.5px solid rgba(230, 182, 82, 0.35)` }}>
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

      <Expand open={true}>
        {/* Form content */}
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>

        <div>
          {!offRouteCustomerId ? (
            offRouteSearchOpen ? (
              <div style={{ background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${C.border}` }}>
                  <Search size={14} style={{ color: C.inkMute, flexShrink: 0 }} />
                  <input
                    type="text"
                    value={offRouteSearch}
                    onChange={(e) => setOffRouteSearch(e.target.value)}
                    placeholder="Search customer..."
                    style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: C.ink }}
                  />
                  <button type="button" onClick={() => { setOffRouteSearchOpen(false); setOffRouteSearch(""); }}
                    style={{ background: "none", border: "none", color: C.inkMute, cursor: "pointer", padding: 0, flexShrink: 0 }}>
                    <X size={14} />
                  </button>
                </div>
                <div style={{ maxHeight: 200, overflowY: "auto" }}>
                  {[...adHocCustomers]
                    .filter(c => c.customer_name.toLowerCase().includes(offRouteSearch.toLowerCase()))
                    .sort((a, b) => a.customer_name.localeCompare(b.customer_name))
                    .map(c => (
                      <button key={c.id} type="button" onClick={() => { setOffRouteCustomerId(c.id); setOffRouteSearchOpen(false); setOffRouteSearch(""); }}
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
              <button type="button" onClick={() => setOffRouteSearchOpen(true)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 14, border: `1px solid ${C.border}`, background: C.surface, cursor: "pointer" }}>
                <Search size={14} style={{ color: C.inkMute, flexShrink: 0 }} />
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: C.inkMute }}>Search customer...</span>
              </button>
            )
          ) : (() => {
            const customer = adHocCustomers.find(c => c.id === offRouteCustomerId);
            return customer ? (
              <div style={{ background: C.cream, borderRadius: 14, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, border: `1px solid ${C.border}` }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: C.green, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                  {customer.customer_name.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 13, color: C.ink, lineHeight: 1.2 }}>{customer.customer_name}</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: C.inkMute, marginTop: 2 }}>{customer.account_number}</div>
                </div>
                <button type="button" onClick={() => setOffRouteCustomerId("")} style={{ background: "none", border: "none", color: C.inkMute, cursor: "pointer", padding: 0 }}>
                  <X size={14} />
                </button>
              </div>
            ) : null;
          })()}
        </div>

        <div style={{ background: C.cream, borderRadius: 16, padding: 12 }}>
          <div style={{ fontSize: 10.5, color: C.inkMute, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 600, fontFamily: "'DM Sans', sans-serif", marginBottom: 8 }}>
            Order
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 0.6fr 1fr", gap: 8 }}>
            <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
              <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>№</div>
              <input value={offRouteOrderNumber} onChange={(e) => setOffRouteOrderNumber(e.target.value)}
                onBlur={resetMobileZoom}
                type="text" placeholder="Order #" inputMode="numeric" style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }} />
            </label>
            <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
              <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>QTY</div>
              <input type="number" min="0" step="1" value={offRouteOrderQty} onChange={(e) => setOffRouteOrderQty(e.target.value)}
                onBlur={resetMobileZoom}
                placeholder="0" inputMode="numeric" style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }} />
            </label>
            <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
              <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>VALUE</div>
              <input type="text" min="0" step="0.01" value={offRouteOrderAmount} onChange={(e) => setOffRouteOrderAmount(e.target.value)}
                onBlur={resetMobileZoom}
                placeholder="0.00" inputMode="decimal" style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }} />
            </label>
          </div>
        </div>

        <div>
          <div style={{ fontSize: 10, color: C.inkMute, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif", marginBottom: 6 }}>
            NOTES · OPTIONAL
          </div>
          <Textarea value={offRouteNotes} onChange={(e) => setOffRouteNotes(e.target.value)}
            onBlur={resetMobileZoom} rows={2}
            className="text-sm resize-none" style={{ borderColor: C.border, background: C.surface }} />
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
            title={navigator.onLine ? "Will submit now" : "You're offline — will sync later"}
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
            {offRouteSubmitting ? "Logging…" : "Log order"}
          </Button>
        </div>
        </div>
      </Expand>
    </div>
  );
}
