import { useEffect, useState } from "preact/hooks";

function computePreferTouchShell(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("touchShell") === "1") {
      return true;
    }
  } catch {
    /* ignore invalid URL */
  }
  if (navigator.maxTouchPoints === 0) return false;
  return (
    window.matchMedia("(hover: none)").matches ||
    window.matchMedia("(pointer: coarse)").matches
  );
}

/**
 * When true, render the touch-oriented shell (`.layout-mobile`).
 *
 * Requires **touch hardware** plus a **touch-primary** media signal so
 * touchscreen laptops (mouse = fine pointer, hover capable) keep the
 * desktop shell. Phones/tablets typically match `(hover: none)` or
 * `(pointer: coarse)`.
 *
 * Subscribes to those media queries so docking, external pointers, or
 * devtools device mode can update the shell without reload.
 *
 * **Debug:** append `?touchShell=1` to the URL to force the touch shell in
 * desktop browsers (e.g. Cursor browser / Playwright where `maxTouchPoints` is 0).
 */
export function usePreferTouchShell(): boolean {
  const [value, setValue] = useState(computePreferTouchShell);

  useEffect(() => {
    function update() {
      setValue(computePreferTouchShell());
    }
    update();
    const hoverNone = window.matchMedia("(hover: none)");
    const pointerCoarse = window.matchMedia("(pointer: coarse)");
    hoverNone.addEventListener("change", update);
    pointerCoarse.addEventListener("change", update);
    return () => {
      hoverNone.removeEventListener("change", update);
      pointerCoarse.removeEventListener("change", update);
    };
  }, []);

  return value;
}
