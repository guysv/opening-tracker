import { useMemo, useRef } from "preact/hooks";

import type { DateRangeSec } from "../lib/explorerData";

const STEP = 1;

function secRangeToDayIndices(
  lowSec: number,
  highSec: number,
  originSec: number,
  maxDayIndex: number,
): [number, number] {
  let low = Math.floor((lowSec - originSec) / 86400);
  let high = Math.floor((highSec - originSec) / 86400);
  low = Math.max(0, Math.min(maxDayIndex, low));
  high = Math.max(0, Math.min(maxDayIndex, high));
  if (high < low) [low, high] = [high, low];
  return [low, high];
}

function panDayWindow(
  low: number,
  high: number,
  deltaDays: number,
  minDay: number,
  maxDay: number,
): [number, number] {
  const span = high - low;
  let nLow = Math.round(low + deltaDays);
  let nHigh = nLow + span;

  if (nLow < minDay) {
    nLow = minDay;
    nHigh = minDay + span;
  }
  if (nHigh > maxDay) {
    nHigh = maxDay;
    nLow = maxDay - span;
  }
  return [nLow, nHigh];
}

function formatDateLabel(sec: number): string {
  const d = new Date(sec * 1000);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}

type DateRangeSliderProps = {
  /** DB-derived min/max (UTC day-aligned). */
  bounds: DateRangeSec;
  value: DateRangeSec;
  onChange: (range: DateRangeSec) => void;
};

export function DateRangeSlider({ bounds, value, onChange }: DateRangeSliderProps) {
  const originSec = bounds[0];
  const maxDayIndex = useMemo(
    () => Math.max(0, Math.floor((bounds[1] - bounds[0]) / 86400)),
    [bounds[0], bounds[1]],
  );

  const [lowDay, highDay] = useMemo(
    () => secRangeToDayIndices(value[0], value[1], originSec, maxDayIndex),
    [value[0], value[1], originSec, maxDayIndex],
  );

  const dualRangeRef = useRef<HTMLDivElement>(null);

  const spanDays = maxDayIndex || 1;
  const lowPct = ((lowDay - 0) / spanDays) * 100;
  const highPct = ((highDay - 0) / spanDays) * 100;

  function emitFromDays(nextLow: number, nextHigh: number) {
    const start = originSec + nextLow * 86400;
    const end = Math.min(bounds[1], originSec + nextHigh * 86400 + 86399);
    onChange([start, end]);
  }

  function handlePanPointerDown(e: PointerEvent) {
    e.preventDefault();
    const panEl = e.currentTarget as HTMLElement;
    const container = dualRangeRef.current;
    if (!container) return;

    panEl.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startLow = lowDay;
    const startHigh = highDay;
    const pid = e.pointerId;

    function onMove(ev: PointerEvent) {
      if (ev.pointerId !== pid) return;
      const el = dualRangeRef.current;
      if (!el) return;
      const w = el.getBoundingClientRect().width;
      if (w <= 0) return;
      const dDay = ((ev.clientX - startX) / w) * maxDayIndex;
      const [nLow, nHigh] = panDayWindow(startLow, startHigh, dDay, 0, maxDayIndex);
      emitFromDays(nLow, nHigh);
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

  const startLowSec = originSec + lowDay * 86400;
  const endHighSec = Math.min(bounds[1], originSec + highDay * 86400 + 86399);
  const labelMin = formatDateLabel(startLowSec);
  const labelMax = formatDateLabel(endHighSec);

  return (
    <section class="date-filter" aria-label="Game date range">
      <span class="date-filter-inline-label">Date:</span>
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
          aria-label="Drag to shift the date window"
          onPointerDown={handlePanPointerDown}
        />
        <input
          type="range"
          class="dual-range-input dual-range-input--low"
          min={0}
          max={maxDayIndex}
          step={STEP}
          value={lowDay}
          onInput={(e) => {
            const v = Number((e.target as HTMLInputElement).value);
            emitFromDays(Math.min(v, highDay), highDay);
          }}
        />
        <input
          type="range"
          class="dual-range-input dual-range-input--high"
          min={0}
          max={maxDayIndex}
          step={STEP}
          value={highDay}
          onInput={(e) => {
            const v = Number((e.target as HTMLInputElement).value);
            emitFromDays(lowDay, Math.max(v, lowDay));
          }}
        />
      </div>
      <div class="date-filter-range-below">
        <span class="date-filter-value date-filter-value--min">{labelMin}</span>
        <span class="date-filter-value date-filter-value--max">{labelMax}</span>
      </div>
    </section>
  );
}
