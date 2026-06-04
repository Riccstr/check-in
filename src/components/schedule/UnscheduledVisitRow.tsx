import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Check, Clock, ChevronDown, Pencil, Plus } from "lucide-react";
import { fmtDuration } from "@/lib/timeUtils";
import { C, resetMobileZoom, Expand } from "./ScheduleHelpers";

export function UnscheduledVisitRow({
  visit,
  isExpanded,
  onToggle,
  onOrderUpdated,
}: {
  visit: any;
  isExpanded: boolean;
  onToggle: () => void;
  onOrderUpdated: () => void | Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [orderNumber, setOrderNumber] = useState("");
  const [orderQty, setOrderQty] = useState("");
  const [orderAmount, setOrderAmount] = useState("");
  const [actionInProgress, setActionInProgress] = useState(false);

  const customerName = visit.customers?.customer_name ?? "Unknown";
  const isOffRoute = visit.status === "off_route";

  return (
    <div
      className="rounded-[22px] overflow-hidden"
      style={{ background: C.surface, border: `1px solid ${C.border}`, boxShadow: "0 1px 0 rgba(255,255,255,0.7) inset, 0 1px 2px rgba(23,23,21,0.04)" }}
    >
      {/* Collapsed header row */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-4 px-5 py-4 text-left"
        style={{ background: "transparent" }}
      >
        <div className="shrink-0 rounded-[14px] flex items-center justify-center"
          style={{ width: 42, height: 42, background: isOffRoute ? "rgba(230,182,82,0.15)" : C.green, color: isOffRoute ? C.sun : "#fff" }}>
          {isOffRoute ? <Plus size={16} /> : <Check size={18} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-syne font-600 text-base" style={{ color: C.ink, letterSpacing: "-0.2px", lineHeight: 1.1 }}>{customerName}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold"
              style={{ color: isOffRoute ? C.sun : C.green, fontFamily: "'DM Sans', sans-serif" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: isOffRoute ? C.sun : C.green, display: "inline-block", flexShrink: 0 }} />
              {isOffRoute ? "Off-Route" : "Unscheduled"}
            </span>
            {!isOffRoute && visit.duration_minutes > 0 && (
              <span className="text-[11px] font-semibold inline-flex items-center gap-1" style={{ color: C.inkSoft, fontFamily: "'DM Sans', sans-serif" }}>
                · <Clock size={11} /> {visit.duration_minutes}m
              </span>
            )}
            {visit.order_amount != null && (
              <span className="text-[11px]" style={{ color: C.inkMute, fontFamily: "'DM Sans', sans-serif" }}>
                · R {parseFloat(String(visit.order_amount)).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            )}
          </div>
        </div>
        <span style={{ color: C.inkMute, transform: isExpanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 320ms cubic-bezier(0.22,0.61,0.36,1)" }}>
          <ChevronDown size={18} />
        </span>
      </button>

      {/* Expanded content */}
      <Expand open={isExpanded}>
        <div style={{ height: 1, background: `linear-gradient(90deg, transparent, ${C.border}, transparent)` }} />
        <div className="px-[18px] pb-5" style={{ paddingTop: "14px" }}>

          {/* 4-chip row */}
          <div style={{ background: C.cream, borderRadius: 14, padding: "6px", display: "flex", gap: 4, marginBottom: 10 }}>
            {[
              { label: "ARRIVED", value: !isOffRoute && visit.arrival_time ? visit.arrival_time.slice(0, 5) : null },
              { label: "PHOTO", value: visit.photo_url ? "✓" : null },
              { label: "ORDER", value: visit.order_number ? "✓" : null },
              { label: "LEFT", value: !isOffRoute && visit.leaving_time ? visit.leaving_time.slice(0, 5) : null },
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

          {/* 2-col tiles */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            {!isOffRoute && (
              <div style={{ background: C.surfaceAlt, borderRadius: 16, padding: "12px 14px" }}>
                <div style={{ fontSize: 10.5, color: C.inkMute, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 700, fontFamily: "'DM Sans', sans-serif", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Clock size={13} />Time at stop
                </div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, color: C.ink, fontWeight: 700, letterSpacing: "-0.4px", marginTop: 4, lineHeight: 1 }}>
                  {visit.duration_minutes > 0 ? fmtDuration(visit.duration_minutes) : "—"}
                </div>
                {visit.arrival_time && visit.leaving_time && (
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11.5, color: C.inkSoft, marginTop: 4 }}>
                    {visit.arrival_time.slice(0, 5)} → {visit.leaving_time.slice(0, 5)}
                  </div>
                )}
              </div>
            )}
            {(visit.order_number || visit.order_amount != null) && (
              <div style={{ background: C.surfaceAlt, borderRadius: 16, padding: "12px 14px" }}>
                <div style={{ fontSize: 10.5, color: C.inkMute, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}>
                  Order {visit.order_number}
                </div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, color: C.ink, fontWeight: 700, letterSpacing: "-0.4px", marginTop: 4, lineHeight: 1 }}>
                  R {parseFloat(String(visit.order_amount || 0)).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11.5, color: C.inkSoft, marginTop: 4 }}>
                  {visit.order_quantity} units
                </div>
              </div>
            )}
          </div>

          {/* Edit Order button */}
          {!isEditing && (
            <button type="button"
              onClick={() => {
                setOrderNumber(visit.order_number || "");
                setOrderQty(visit.order_quantity != null ? String(visit.order_quantity) : "");
                setOrderAmount(visit.order_amount != null ? String(visit.order_amount) : "");
                setIsEditing(true);
              }}
              style={{ width: "100%", height: 38, borderRadius: 12, border: `1px solid ${C.border}`, background: C.surface, color: C.inkSoft, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 12.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Pencil size={13} /> Edit order details
            </button>
          )}

          {/* Inline edit form */}
          {isEditing && (
            <div style={{ background: C.cream, borderRadius: 16, padding: 12, border: `1px solid ${C.border}` }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.3fr 0.6fr 1fr", gap: 8, marginBottom: 10 }}>
                <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                  <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>№</div>
                  <input type="text" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} onBlur={resetMobileZoom} placeholder="PO-0000"
                    style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }} />
                </label>
                <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                  <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>Qty</div>
                  <input type="number" min="0" step="1" value={orderQty} onChange={(e) => setOrderQty(e.target.value)} onBlur={resetMobileZoom} placeholder="0"
                    style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }} />
                </label>
                <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                  <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>Value</div>
                  <input type="number" min="0" step="0.01" value={orderAmount} onChange={(e) => setOrderAmount(e.target.value)} onBlur={resetMobileZoom} placeholder="R 0,00"
                    style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }} />
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 8 }}>
                <button type="button" onClick={() => setIsEditing(false)}
                  style={{ height: 40, borderRadius: 12, border: "none", cursor: "pointer", background: "transparent", color: C.inkSoft, fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13 }}>
                  Cancel
                </button>
                <button type="button" onClick={async () => {
                  setActionInProgress(true);
                  try {
                    const { error } = await supabase.from("visits").update({
                      order_number: orderNumber || null,
                      order_quantity: orderQty !== "" ? Number(orderQty) : null,
                      order_amount: orderAmount !== "" ? Number(orderAmount) : null,
                    } as any).eq("id", visit.id);
                    if (error) { toast.error(error.message); }
                    else { toast.success("Order updated"); setIsEditing(false); await onOrderUpdated(); }
                  } catch { toast.error("Failed to update"); }
                  finally { setActionInProgress(false); }
                }}
                  disabled={actionInProgress}
                  style={{ height: 40, borderRadius: 12, border: "none", cursor: "pointer", background: `linear-gradient(180deg, ${C.greenMid} 0%, ${C.green} 100%)`, color: "#fff", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, boxShadow: `0 8px 16px -8px ${C.green}aa` }}>
                  <Check size={14} /> Save changes
                </button>
              </div>
            </div>
          )}
        </div>
      </Expand>
    </div>
  );
}
