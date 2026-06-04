import { Check } from "lucide-react";
import { fmtDuration } from "@/lib/timeUtils";
import { C } from "./ScheduleHelpers";

// ─── EodSummaryModal ──────────────────────────────────────────────────────────

export interface SummaryStats {
  total: number;
  visited: number;
  skipped: number;
  orders: number;
  totalOrderValue: number;
  avgDuration: number; // minutes
  histAvgOrders: number | null;     // null = fewer than 2 historical days, don't show
  histAvgOrderValue: number | null; // null = fewer than 2 historical days, don't show
}

export function EodSummaryModal({ stats, onClose }: { stats: SummaryStats; onClose: () => void }) {
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
