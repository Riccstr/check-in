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
