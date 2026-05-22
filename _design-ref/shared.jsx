// Shared data + helpers across all three direction prototypes

const SCHEDULE_DATA = [
  { id: 'c1', name: 'Pick n Pay Mooketsi',     code: '#PNP-MKT', town: 'Mooketsi',   status: 'visited',  arrivalTime: '08:42', leavingTime: '09:01', duration: 19, order: { number: 'PO-4821', qty: 24, value: 'R 4 280,00' } },
  { id: 'c2', name: 'Spar Duiwelskloof',       code: '#SPR-DWK', town: 'Duiwelskloof', status: 'visited',  arrivalTime: '09:18', leavingTime: '09:34', duration: 16, order: { number: 'PO-4822', qty: 18, value: 'R 3 120,00' } },
  { id: 'c3', name: 'Saverite Tzaneen',        code: '#SAV-TZN', town: 'Tzaneen',    status: 'active',   arrivalTime: '10:04', leavingTime: '',      duration: 0,  order: null },
  { id: 'c4', name: 'Boxer Ga-Kgapane',        code: '#BXR-GKG', town: 'Ga-Kgapane', status: 'pending',  arrivalTime: '',      leavingTime: '',      duration: 0,  order: null },
  { id: 'c5', name: 'Cambridge Foods Motupa',  code: '#CAM-MTP', town: 'Motupa',     status: 'pending',  arrivalTime: '',      leavingTime: '',      duration: 0,  order: null },
  { id: 'c6', name: 'Choppies Tzaneen North',  code: '#CHP-TZN', town: 'Tzaneen',    status: 'pending',  arrivalTime: '',      leavingTime: '',      duration: 0,  order: null },
];

// Simplified logo mark — single SVG glyph, no double-circle clutter
function BrandMark({ size = 28, color = '#1D5C3F', accent = '#4CAF78' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <path d="M16 2.5C9.4 2.5 4 7.8 4 14.4c0 7.6 9.5 14.4 11.3 15.6.4.3 1 .3 1.4 0C18.5 28.8 28 22 28 14.4 28 7.8 22.6 2.5 16 2.5z" fill={color}/>
      <path d="M10.5 14.5l3.8 3.8 7.2-7.2" stroke={accent} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}

// SVG icons (used across directions for consistency)
const Icon = {
  Calendar: (p) => <svg width={p.size||16} height={p.size||16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>,
  Eye: (p) => <svg width={p.size||16} height={p.size||16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>,
  Logout: (p) => <svg width={p.size||16} height={p.size||16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>,
  ChevDown: (p) => <svg width={p.size||16} height={p.size||16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>,
  ChevLeft: (p) => <svg width={p.size||16} height={p.size||16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>,
  ChevRight: (p) => <svg width={p.size||16} height={p.size||16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>,
  Check: (p) => <svg width={p.size||16} height={p.size||16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>,
  Plus: (p) => <svg width={p.size||16} height={p.size||16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>,
  Skip: (p) => <svg width={p.size||16} height={p.size||16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4l10 8-10 8V4zM19 5v14"/></svg>,
  Camera: (p) => <svg width={p.size||16} height={p.size||16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>,
  Note: (p) => <svg width={p.size||16} height={p.size||16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h13l3 3v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 9h8M8 13h8M8 17h5"/></svg>,
  Wifi: (p) => <svg width={p.size||14} height={p.size||14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.55a11 11 0 0 1 14 0M1.5 9a16 16 0 0 1 21 0M8.5 16a6 6 0 0 1 7 0"/><circle cx="12" cy="20" r="1" fill="currentColor"/></svg>,
  WifiOff: (p) => <svg width={p.size||14} height={p.size||14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a11 11 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="currentColor"/></svg>,
  Menu: (p) => <svg width={p.size||18} height={p.size||18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h18M3 6h18M3 18h18"/></svg>,
  Close: (p) => <svg width={p.size||16} height={p.size||16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>,
  Pin: (p) => <svg width={p.size||16} height={p.size||16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-7.6 8-13a8 8 0 0 0-16 0c0 5.4 8 13 8 13z"/><circle cx="12" cy="9" r="2.5"/></svg>,
  Clock: (p) => <svg width={p.size||16} height={p.size||16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>,
  Search: (p) => <svg width={p.size||16} height={p.size||16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>,
};

// Phone status-bar replacement (top bar inside the app, not iOS chrome — iOS frame provides that)

// Common app top bar
function AppTopBar({ online = true, logo, dark = false, accent, onMenu }) {
  const bg = dark ? 'transparent' : '#fff';
  const fg = dark ? '#fff' : '#1A1A1A';
  const pillBg = dark ? 'rgba(255,255,255,0.12)' : '#F4F1EC';
  const pillFg = dark ? '#fff' : '#3a3a3a';
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: bg, borderBottom: dark ? 'none' : '1px solid rgba(0,0,0,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {logo}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 999, background: pillBg, color: pillFg, fontSize: 12, fontWeight: 600 }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: online ? '#2E9A6B' : '#E65100' }}></span>
          {online ? 'Online' : 'Offline'}
        </div>
        <button onClick={onMenu} aria-label="Menu" style={{ width: 34, height: 34, borderRadius: 10, background: dark ? 'rgba(255,255,255,0.1)' : '#F4F1EC', color: fg, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <Icon.Menu size={18}/>
        </button>
      </div>
    </div>
  );
}

// Smooth height auto-animate wrapper (for card expand/collapse)
function Expand({ open, children, duration = 320 }) {
  const ref = React.useRef(null);
  const [h, setH] = React.useState(open ? 'auto' : 0);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open) {
      const target = el.scrollHeight;
      setH(0);
      requestAnimationFrame(() => setH(target));
      const t = setTimeout(() => setH('auto'), duration);
      return () => clearTimeout(t);
    } else {
      const cur = el.scrollHeight;
      setH(cur);
      requestAnimationFrame(() => setH(0));
    }
  }, [open]);
  return (
    <div ref={ref} style={{
      height: typeof h === 'number' ? h + 'px' : h,
      overflow: 'hidden',
      transition: `height ${duration}ms cubic-bezier(0.22, 0.61, 0.36, 1)`,
      opacity: open ? 1 : 0.001,
    }}>
      <div style={{
        transform: open ? 'translateY(0)' : 'translateY(-6px)',
        opacity: open ? 1 : 0,
        transition: `transform ${duration}ms cubic-bezier(0.22,0.61,0.36,1), opacity ${duration*0.7}ms ease`,
      }}>
        {children}
      </div>
    </div>
  );
}

window.SCHEDULE_DATA = SCHEDULE_DATA;
window.BrandMark = BrandMark;
window.Icon = Icon;
window.AppTopBar = AppTopBar;
window.Expand = Expand;
