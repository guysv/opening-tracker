import { useRef } from "preact/hooks";

import type { EloRange } from "../lib/explorerData";

const MIN_ELO = 0;
const MAX_ELO = 3500;
const STEP = 50;

type EloRangeSliderProps = {
  value: EloRange;
  onChange: (range: EloRange) => void;
};

/** Shift both endpoints by `delta` (Elo units), preserving span; clamp to [MIN_ELO, MAX_ELO]. */
function panWindow(low: number, high: number, delta: number): EloRange {
  const span = high - low;
  let nLow = Math.round((low + delta) / STEP) * STEP;
  let nHigh = nLow + span;

  if (nLow < MIN_ELO) {
    nLow = MIN_ELO;
    nHigh = MIN_ELO + span;
  }
  if (nHigh > MAX_ELO) {
    nHigh = MAX_ELO;
    nLow = MAX_ELO - span;
  }
  return [nLow, nHigh];
}

export function EloRangeSlider({ value, onChange }: EloRangeSliderProps) {
  const [low, high] = value;
  const dualRangeRef = useRef<HTMLDivElement>(null);

  const lowPct = ((low - MIN_ELO) / (MAX_ELO - MIN_ELO)) * 100;
  const highPct = ((high - MIN_ELO) / (MAX_ELO - MIN_ELO)) * 100;

  function handlePanPointerDown(e: PointerEvent) {
    e.preventDefault();
    const panEl = e.currentTarget as HTMLElement;
    const container = dualRangeRef.current;
    if (!container) return;

    panEl.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startLow = low;
    const startHigh = high;
    const pid = e.pointerId;

    function onMove(ev: PointerEvent) {
      if (ev.pointerId !== pid) return;
      const el = dualRangeRef.current;
      if (!el) return;
      const w = el.getBoundingClientRect().width;
      if (w <= 0) return;
      const dElo = ((ev.clientX - startX) / w) * (MAX_ELO - MIN_ELO);
      onChange(panWindow(startLow, startHigh, dElo));
    }

    function onDone(ev: PointerEvent) {
      if (ev.pointerId !== pid) return;
      try {
        panEl.releasePointerCapture(pid);
      } catch {
        /* already released */
      }
      panEl.removeEventListener("pointermove", onMove);
      panEl.removeEventListener("pointerup", onDone);
      panEl.removeEventListener("pointercancel", onDone);
    }

    panEl.addEventListener("pointermove", onMove);
    panEl.addEventListener("pointerup", onDone);
    panEl.addEventListener("pointercancel", onDone);
  }

  return (
    <section class="elo-filter" aria-label="Opponent Elo range">
      <span class="elo-filter-inline-label">Elo:</span>
      <div class="dual-range" ref={dualRangeRef}>
        <div class="dual-range-track" />
        <div
          class="dual-range-fill"
          style={{ left: `${lowPct}%`, right: `${100 - highPct}%` }}
        />
        <div
          class="dual-range-pan"
          style={{ left: `${lowPct}%`, right: `${100 - highPct}%` }}
          role="button"
          tabIndex={-1}
          aria-label="Drag to shift the Elo window"
          onPointerDown={handlePanPointerDown}
        />
        <input
          type="range"
          class="dual-range-input dual-range-input--low"
          min={MIN_ELO}
          max={MAX_ELO}
          step={STEP}
          value={low}
          onInput={(e) => {
            const v = Number((e.target as HTMLInputElement).value);
            onChange([Math.min(v, high - STEP), high]);
          }}
        />
        <input
          type="range"
          class="dual-range-input dual-range-input--high"
          min={MIN_ELO}
          max={MAX_ELO}
          step={STEP}
          value={high}
          onInput={(e) => {
            const v = Number((e.target as HTMLInputElement).value);
            onChange([low, Math.max(v, low + STEP)]);
          }}
        />
      </div>
      <div class="elo-filter-range-below">
        <span class="elo-filter-value elo-filter-value--min">{low}</span>
        <span class="elo-filter-value elo-filter-value--max">{high}</span>
      </div>
    </section>
  );
}
