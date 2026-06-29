import React, { useState } from "react";

// ─── RippleButton ─────────────────────────────────────────────────────────────
// Primary action button with a brief brightness flash on press to give
// instant visual feedback before the async action completes.

export function RippleButton({
  onClick,
  disabled,
  style,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const [flashing, setFlashing] = useState(false);

  const handleClick = () => {
    if (disabled) return;
    setFlashing(true);
    setTimeout(() => setFlashing(false), 500);
    onClick?.();
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={handleClick}
      style={{
        ...style,
        position: "relative",
        overflow: "hidden",
        transition: "filter 250ms ease",
        filter: flashing ? "brightness(1.5)" : "brightness(1)",
      }}
    >
      {children}
    </button>
  );
}

// ─── ShimmerButton ────────────────────────────────────────────────────────────
// A button that displays a moving shimmer gradient while a loading state is
// active. Uses the global .btn-shimmer CSS class defined in index.css.
// Pass idleStyle for the non-loading appearance; the shimmer overrides it
// automatically when loading=true.

export function ShimmerButton({
  onClick,
  disabled,
  loading,
  idleStyle,
  children,
  loadingLabel,
}: {
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  idleStyle?: React.CSSProperties;
  children: React.ReactNode;
  loadingLabel?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={onClick}
      className={loading ? "btn-shimmer" : ""}
      style={{
        ...idleStyle,
        cursor: loading || disabled ? "not-allowed" : "pointer",
      }}
    >
      {loading ? (loadingLabel ?? children) : children}
    </button>
  );
}
