// Shared palette + chrome for the admin redesign.
// Inline-styles approach mirroring src/pages/DailySchedule.tsx — palette values
// match the rep app's `C` object so admin and rep feel like one product.

import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Users, CalendarDays, Eye, Download, ShieldCheck, Settings, ChevronDown, ChevronRight, Search, LogOut } from "lucide-react";
import type { ReactNode } from "react";

// ─── palette ────────────────────────────────────────────────────────────────
// All exported so per-page styled bits can pull from the same vocabulary.

export const A = {
  // page chrome
  bg:         "#F9F7F1",
  panel:      "#FFFFFF",
  panelTint:  "#FCFBF6",
  border:     "#E6E1D2",
  borderSoft: "#F0EBDD",
  borderRow:  "#F4F0E3",

  // ink scale
  ink:        "#171715",
  inkSoft:    "#535048",
  inkMute:    "#8E887B",
  inkDim:     "#B5AE9C",

  // primary = rep app's deep green
  green:      "#1B5238",
  greenDeep:  "#0D2E1F",
  greenMid:   "#2A6F4A",
  greenSoft:  "#DDE9E1",
  greenWash:  "#EEF4F0",
  greenInk:   "#0E3A24",

  // cream — current week / hover tints / area tags
  cream:      "#F4ECDB",
  creamDeep:  "#EBE0C7",

  // semantic
  sun:        "#C68A1F",        // off-route / live indicators
  sunBg:      "#FBF1DA",
  sunPure:    "#E6B652",        // matches rep app's `sun` exactly
  transit:    "#3D6B8C",        // travelling between stops
  transitBg:  "#E6EDF4",
  done:       "#5C5851",        // day-complete neutral
  doneBg:     "#EFEDE6",
  danger:     "#B85A4A",        // skip / destructive — matches rep app's danger
  dangerBg:   "#F8E4DE",

  // type
  sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
} as const;

// ─── status pill semantics ──────────────────────────────────────────────────
// Mirrors the rep app's status colour vocabulary so a visit looks the same
// on the rep's phone and on the admin dashboard.

export type RepStatusKey = "checked_in" | "travelling" | "day_complete" | "not_started" | "no_schedule";

export const STATUS_META: Record<RepStatusKey, { label: string; bg: string; fg: string; dot: string; pulse?: boolean }> = {
  checked_in:   { label: "Checked in",   bg: A.greenSoft, fg: A.green,    dot: A.green,   pulse: true },
  travelling:   { label: "Travelling",   bg: A.transitBg, fg: A.transit,  dot: A.transit },
  day_complete: { label: "Day complete", bg: A.doneBg,    fg: A.done,     dot: A.done },
  not_started:  { label: "Not started",  bg: A.doneBg,    fg: A.inkMute,  dot: A.inkMute },
  no_schedule:  { label: "No schedule",  bg: A.doneBg,    fg: A.inkDim,   dot: A.inkDim },
};

// ─── currency formatter ─────────────────────────────────────────────────────
// Centralised so every admin page shows R amounts the same way.

export function zar(n: number, opts: { compact?: boolean } = {}): string {
  const abs = Math.abs(n);
  const fixed = opts.compact && abs >= 1000
    ? (n / 1000).toFixed(1) + "k"
    : n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return "R\u00A0" + fixed;
}

// ─── keyframes (pulse for live dots) ────────────────────────────────────────
// Mounted once at the App root via <PulseKeyframes/> — see doc 02.

export function PulseKeyframes() {
  return (
    <style>{`@keyframes pulseA { 0%,100% { transform: scale(1); opacity: 0.6; } 50% { transform: scale(1.7); opacity: 0; } }`}</style>
  );
}

// ─── Sidebar ────────────────────────────────────────────────────────────────

const SIDEBAR_ITEMS: { to: string; label: string; Icon: typeof LayoutDashboard }[] = [
  { to: "/admin/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { to: "/admin/customers", label: "Customers", Icon: Users },
  { to: "/admin/schedules", label: "Schedules", Icon: CalendarDays },
  { to: "/admin/visits",    label: "Visits",    Icon: Eye },
  { to: "/admin/reports",   label: "Exports",   Icon: Download },
  { to: "/admin/users",     label: "Users",     Icon: ShieldCheck },
  { to: "/admin/account",   label: "Account",   Icon: Settings },
];

/**
 * AdminSidebar — vertical left rail used as the chrome for every admin page.
 * Mounted by AppLayout for users with role === "admin"; pages render no chrome
 * of their own.
 */
export function AdminSidebar({ userInitials, userName, userSubtitle, onSignOut }: { userInitials: string; userName: string; userSubtitle: string; onSignOut?: () => void }) {
  const location = useLocation();
  return (
    <div style={{ width: 224, background: A.panelTint, borderRight: `1px solid ${A.border}`, display: "flex", flexDirection: "column", padding: "18px 12px", flexShrink: 0, fontFamily: A.sans }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 8px 20px" }}>
        <div style={{ width: 26, height: 26, borderRadius: 7, background: A.greenDeep, display: "flex", alignItems: "center", justifyContent: "center", color: A.sunPure, fontWeight: 700, fontSize: 13, letterSpacing: -0.5 }}>C</div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13.5, color: A.ink, letterSpacing: -0.2, lineHeight: 1.1 }}>Check-In</div>
          <div style={{ fontSize: 10, color: A.inkMute, letterSpacing: 0.8, textTransform: "uppercase", fontWeight: 600 }}>Admin</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {SIDEBAR_ITEMS.map(({ to, label, Icon }) => {
          const isActive = location.pathname === to || (to === "/admin/customers" && location.pathname.startsWith("/admin/customer"));
          return (
            <Link key={to} to={to} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 9px", borderRadius: 7, fontSize: 13, fontWeight: isActive ? 600 : 500, color: isActive ? A.green : A.inkSoft, background: isActive ? A.greenSoft : "transparent", textDecoration: "none" }}>
              <Icon size={15} style={{ color: isActive ? A.green : A.inkMute, flexShrink: 0 }} />
              {label}
            </Link>
          );
        })}
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ borderTop: `1px solid ${A.borderSoft}`, marginTop: 10, paddingTop: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 9px" }}>
          <div style={{ width: 28, height: 28, borderRadius: 999, background: A.greenDeep, color: A.cream, fontWeight: 600, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>{userInitials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: A.ink, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{userName}</div>
            <div style={{ fontSize: 10.5, color: A.inkMute, lineHeight: 1.2 }}>{userSubtitle}</div>
          </div>
        </div>
        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "7px 9px", background: "transparent", border: "none", borderRadius: 7, fontSize: 11.5, fontWeight: 600, color: A.danger, fontFamily: A.sans, cursor: "pointer", textAlign: "left" }}
          >
            <LogOut size={12} /> Sign out
          </button>
        )}
      </div>
    </div>
  );
}

// ─── PageHeader ─────────────────────────────────────────────────────────────

export function PageHeader({ title, subtitle, right, breadcrumb }: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  breadcrumb?: ReactNode[];
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "18px 24px 16px", borderBottom: `1px solid ${A.border}`, background: A.panel, gap: 16, flexShrink: 0, fontFamily: A.sans }}>
      <div style={{ minWidth: 0 }}>
        {breadcrumb && (
          <div style={{ fontSize: 11.5, color: A.inkMute, marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
            {breadcrumb.map((b, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                {i > 0 && <ChevronRight size={11} style={{ color: A.inkDim }} />}
                <span style={{ color: i === breadcrumb.length - 1 ? A.ink : A.inkSoft, fontWeight: i === breadcrumb.length - 1 ? 500 : 400 }}>{b}</span>
              </span>
            ))}
          </div>
        )}
        <div style={{ fontSize: 20, fontWeight: 600, color: A.ink, letterSpacing: -0.4, lineHeight: 1.15 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12.5, color: A.inkMute, marginTop: 4 }}>{subtitle}</div>}
      </div>
      {right && <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>{right}</div>}
    </div>
  );
}

// ─── Pill / Tag / StatCard / FilterChip ─────────────────────────────────────

export function Pill({ status }: { status: RepStatusKey }) {
  const s = STATUS_META[status];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", background: s.bg, color: s.fg, borderRadius: 5, fontFamily: A.sans, fontSize: 11, fontWeight: 600, lineHeight: 1 }}>
      <span style={{ position: "relative", width: 6, height: 6 }}>
        <span style={{ position: "absolute", inset: 0, borderRadius: 999, background: s.dot }} />
        {s.pulse && <span style={{ position: "absolute", inset: -2, borderRadius: 999, background: s.dot, opacity: 0.3, animation: "pulseA 1.6s ease-out infinite" }} />}
      </span>
      {s.label}
    </span>
  );
}

export type TagTone = "neutral" | "green" | "sun" | "danger" | "transit" | "cream";

const TAG_TONES: Record<TagTone, { fg: string; bg: string }> = {
  neutral: { fg: A.inkSoft, bg: A.borderSoft },
  green:   { fg: A.green,   bg: A.greenSoft },
  sun:     { fg: A.sun,     bg: A.sunBg },
  danger:  { fg: A.danger,  bg: A.dangerBg },
  transit: { fg: A.transit, bg: A.transitBg },
  cream:   { fg: A.greenInk, bg: A.cream },
};

export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: TagTone }) {
  const t = TAG_TONES[tone];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", fontSize: 10.5, padding: "2px 6px", background: t.bg, color: t.fg, borderRadius: 4, fontWeight: 600, fontFamily: A.sans, letterSpacing: 0.1 }}>{children}</span>
  );
}

export function StatCard({ label, value, sub, accent, mono = true }: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: string;
  mono?: boolean;
}) {
  return (
    <div style={{ background: A.panel, border: `1px solid ${A.border}`, borderRadius: 10, padding: "13px 16px", fontFamily: A.sans }}>
      <div style={{ fontSize: 11, color: A.inkMute, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 6 }}>
        <div style={{ fontFamily: mono ? A.mono : A.sans, fontSize: 24, fontWeight: 600, color: A.ink, letterSpacing: -0.5, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
        {sub && <div style={{ fontSize: 11.5, color: accent || A.inkMute, fontWeight: 500 }}>{sub}</div>}
      </div>
    </div>
  );
}

export function FilterChip({ label, value, active, onClick }: { label: string; value: ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px 5px 11px", border: `1px solid ${active ? A.green : A.border}`, borderRadius: 6, background: active ? A.greenSoft : A.panel, color: active ? A.green : A.inkSoft, fontFamily: A.sans, fontSize: 11.5, fontWeight: 500, cursor: "pointer" }}>
      <span style={{ color: active ? A.green : A.inkMute, fontWeight: 600 }}>{label}</span>
      <span>{value}</span>
      <ChevronDown size={10} style={{ color: active ? A.green : A.inkDim }} />
    </button>
  );
}

// ─── Buttons ────────────────────────────────────────────────────────────────
// Thin styled wrappers — accessible behaviour still flows through native <button>.

export function PrimaryButton({ children, icon, onClick, type = "button", disabled }: {
  children: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 13px", background: disabled ? A.inkDim : A.green, color: A.cream, border: "none", borderRadius: 7, fontSize: 12, fontWeight: 600, fontFamily: A.sans, cursor: disabled ? "not-allowed" : "pointer", boxShadow: disabled ? "none" : `0 1px 0 ${A.greenDeep}` }}>
      {icon}
      {children}
    </button>
  );
}

export function GhostButton({ children, icon, onClick, disabled, tone }: {
  children: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "danger";
}) {
  const isDanger = tone === "danger";
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", background: A.panel, color: isDanger ? A.danger : A.inkSoft, border: `1px solid ${isDanger ? A.dangerBg : A.border}`, borderRadius: 7, fontSize: 12, fontWeight: isDanger ? 600 : 500, fontFamily: A.sans, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 }}>
      {icon}
      {children}
    </button>
  );
}

// ─── ToolbarSearch — purely visual placeholder; pages that need real search
// keep using the shadcn <Input> behind their own styled wrapper. This component
// is used for headers where search is "coming soon" / global. ─────────────────

export function ToolbarSearch({ placeholder = "Search…", width = 260 }: { placeholder?: string; width?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 11px 6px 9px", border: `1px solid ${A.border}`, borderRadius: 7, background: A.panel, color: A.inkMute, width, fontFamily: A.sans }}>
      <Search size={14} />
      <span style={{ fontSize: 12.5, flex: 1 }}>{placeholder}</span>
      <span style={{ fontFamily: A.mono, fontSize: 10, padding: "2px 5px", background: A.borderSoft, borderRadius: 4, color: A.inkMute }}>⌘K</span>
    </div>
  );
}
