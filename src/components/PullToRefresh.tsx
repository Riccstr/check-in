import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

const THRESHOLD   = 120;  // px of pull required to trigger reload
const CAP         = 140;  // maximum visual travel in px
const INDICATOR_H = 44;   // pill height in px — indicator slides down from -INDICATOR_H

export function PullToRefresh() {
  const [pullY,     setPullY]     = useState(0);
  const [triggered, setTriggered] = useState(false);
  const [returning, setReturning] = useState(false);

  // Refs let event handlers read current values without stale closures
  const startYRef  = useRef<number | null>(null);
  const pullYRef   = useRef(0);
  const activeRef  = useRef(false);   // true once a valid downward pull is in progress
  const firedRef   = useRef(false);   // guard against double-firing on touchend

  useEffect(() => {
    // Only activate in standalone PWA mode — browser tabs already have native PTR
    if (!window.matchMedia("(display-mode: standalone)").matches) return;

    const onTouchStart = (e: TouchEvent) => {
      if (window.scrollY !== 0) return;
      startYRef.current = e.touches[0].clientY;
      activeRef.current = false;
      firedRef.current  = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startYRef.current === null) return;

      // Abort if the page has scrolled since touchstart (inner scroll containers)
      if (window.scrollY !== 0) {
        startYRef.current = null;
        return;
      }

      const dy = e.touches[0].clientY - startYRef.current;
      if (dy <= 0) return; // upward swipe — ignore

      // Consume the event so the browser does not also try to scroll or bounce
      e.preventDefault();

      activeRef.current = true;
      setReturning(false);

      const capped = Math.min(dy, CAP);
      pullYRef.current = capped;
      setPullY(capped);
    };

    const onTouchEnd = () => {
      if (!activeRef.current || firedRef.current) {
        startYRef.current = null;
        activeRef.current = false;
        return;
      }

      const py = pullYRef.current;
      startYRef.current = null;
      activeRef.current = false;

      if (py >= THRESHOLD) {
        firedRef.current = true;
        setTriggered(true);
        // Hold the "loading" indicator briefly so the rep sees feedback before reload
        setTimeout(() => window.location.reload(), 600);
      } else {
        // Spring back — enable CSS transition then snap to 0
        setReturning(true);
        setPullY(0);
        pullYRef.current = 0;
        setTimeout(() => setReturning(false), 300);
      }
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove",  onTouchMove,  { passive: false });
    document.addEventListener("touchend",   onTouchEnd,   { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove",  onTouchMove);
      document.removeEventListener("touchend",   onTouchEnd);
    };
  }, []);

  // Nothing to render until a pull begins or reload is triggered
  if (pullY === 0 && !triggered && !returning) return null;

  // translateY: at pullY=0 the pill sits above the screen (-INDICATOR_H).
  // As the user pulls, it slides down proportionally.
  // At pullY = INDICATOR_H the pill's bottom edge reaches the screen top;
  // beyond that it appears increasingly below the top edge.
  // Add 8px padding so a small gap exists when the trigger point is reached.
  const translateY = triggered
    ? 8
    : Math.max(pullY - INDICATOR_H, -INDICATOR_H) + 8;

  // Rotate the icon as the user pulls: 0° at rest → 180° at threshold
  const iconRotation = triggered ? 0 : Math.min((pullY / THRESHOLD) * 180, 180);

  const transition = returning || triggered
    ? "transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1)"
    : "none";

  return (
    <div
      aria-hidden="true"
      style={{
        position:        "fixed",
        top:             0,
        left:            "50%",
        zIndex:          9999,
        transform:       `translateX(-50%) translateY(${translateY}px)`,
        transition,
        pointerEvents:   "none",
        display:         "flex",
        alignItems:      "center",
        justifyContent:  "center",
      }}
    >
      <div
        style={{
          height:         `${INDICATOR_H}px`,
          minWidth:       "44px",
          padding:        "0 14px",
          borderRadius:   "9999px",
          background:     "hsl(var(--primary))",
          color:          "hsl(var(--primary-foreground))",
          display:        "flex",
          alignItems:     "center",
          justifyContent: "center",
          boxShadow:      "0 2px 12px rgba(0,0,0,0.25)",
        }}
      >
        <RefreshCw
          size={20}
          strokeWidth={2.5}
          style={{
            transform:  triggered ? undefined : `rotate(${iconRotation}deg)`,
            transition: triggered ? undefined : "transform 0.05s linear",
          }}
          className={triggered ? "animate-spin" : undefined}
        />
      </div>
    </div>
  );
}
