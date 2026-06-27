"use client";

import { useEffect } from "react";

/**
 * Close a modal/sheet on the Escape key while it's open. Pair with a backdrop
 * onClick + role="dialog"/aria-modal for consistent, accessible overlays.
 */
export function useEscapeToClose(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose]);
}
