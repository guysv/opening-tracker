import type { EloRange } from "../lib/explorerData";

const MIN_ELO = 0;
const MAX_ELO = 3500;
const STEP = 50;

type EloRangeSliderProps = {
  value: EloRange;
  onChange: (range: EloRange) => void;
};

export function EloRangeSlider({ value, onChange }: EloRangeSliderProps) {
  const [low, high] = value;

  const lowPct = ((low - MIN_ELO) / (MAX_ELO - MIN_ELO)) * 100;
  const highPct = ((high - MIN_ELO) / (MAX_ELO - MIN_ELO)) * 100;

  return (
    <section class="elo-filter">
      <h3 class="elo-filter-title">Opponent Elo</h3>
      <div class="elo-filter-labels">
        <span class="elo-filter-value">{low}</span>
        <span class="elo-filter-value">{high}</span>
      </div>
      <div class="dual-range">
        <div class="dual-range-track" />
        <div
          class="dual-range-fill"
          style={{ left: `${lowPct}%`, right: `${100 - highPct}%` }}
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
    </section>
  );
}
