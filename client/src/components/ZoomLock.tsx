"use client";

import { useEffect } from "react";
import { isAppleMobile } from "@/lib/pushPlatform";

/**
 * Locks the page scale on touch devices.
 *
 * The viewport meta (maximum-scale=1, user-scalable=no) already stops the
 * auto-zoom on input focus and blocks pinch/double-tap on Android and in
 * installed PWAs. Safari on iPhone, however, keeps pinch-zoom enabled in a
 * normal tab regardless of the meta tag, so the two gesture listeners below
 * cancel it there as well. Double-tap zoom is handled by `touch-action:
 * manipulation` in globals.css.
 */
export function ZoomLock() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    // Android and installed PWAs honour the viewport meta already; only Safari
    // on iPhone/iPad needs the gesture guard, so nothing runs elsewhere.
    if (!isAppleMobile()) return;

    const cancel = (event: Event) => {
      event.preventDefault();
    };

    const cancelPinch = (event: TouchEvent) => {
      // Two or more fingers moving = pinch. Single-finger scroll stays untouched.
      if (event.touches.length > 1) event.preventDefault();
    };

    const options: AddEventListenerOptions = { passive: false };

    // Safari-only gesture events (pinch / rotate).
    document.addEventListener("gesturestart", cancel, options);
    document.addEventListener("gesturechange", cancel, options);
    document.addEventListener("gestureend", cancel, options);
    document.addEventListener("touchmove", cancelPinch, options);

    return () => {
      document.removeEventListener("gesturestart", cancel);
      document.removeEventListener("gesturechange", cancel);
      document.removeEventListener("gestureend", cancel);
      document.removeEventListener("touchmove", cancelPinch);
    };
  }, []);

  return null;
}
