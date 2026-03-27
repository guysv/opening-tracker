import type { StockfishDisplayEval } from "../lib/stockfishEval";

const CP_CLAMP = 600;

/** Map White-centric cp to 0–100 (0 = bottom/black, 100 = top/white). */
export function evalToMarkerPercent(ev: StockfishDisplayEval): number {
  if (ev.kind === "mate" && ev.mate != null) {
    if (ev.mate > 0) return 92;
    if (ev.mate < 0) return 8;
    return 50;
  }
  const cp = ev.cp ?? 0;
  const t = Math.max(-CP_CLAMP, Math.min(CP_CLAMP, cp)) / CP_CLAMP;
  return 50 + t * 50;
}

function formatEval(ev: StockfishDisplayEval, perspective: "w" | "b"): string {
  const blackPerspective = perspective === "b";
  if (ev.kind === "mate" && ev.mate != null) {
    const m = blackPerspective ? -ev.mate : ev.mate;
    if (m > 0) return `+M${m}`;
    if (m < 0) return `M${m}`;
    return "0";
  }
  const cp = blackPerspective ? -(ev.cp ?? 0) : (ev.cp ?? 0);
  const pawns = cp / 100;
  const sign = pawns > 0 ? "+" : "";
  return `${sign}${pawns.toFixed(2)}`;
}

type EvalBarProps = {
  evalData: StockfishDisplayEval | null;
  loading: boolean;
  error: boolean;
  perspective: "w" | "b";
};

export function EvalBar({
  evalData,
  loading,
  error,
  perspective,
}: EvalBarProps) {
  const whiteAtBottom = perspective === "w";
  const pct = evalData ? evalToMarkerPercent(evalData) : 50;
  const label = evalData ? formatEval(evalData, perspective) : "—";
  const whiteHeight = `${pct}%`;
  const blackHeight = `${100 - pct}%`;

  return (
    <div class="eval-bar-wrap" aria-label="Engine evaluation">
      <div class="eval-bar-track">
        {whiteAtBottom ? (
          <>
            <div
              class="eval-bar-fill eval-bar-fill--dark"
              style={{ height: blackHeight }}
            />
            <div
              class="eval-bar-fill eval-bar-fill--light"
              style={{ height: whiteHeight }}
            />
          </>
        ) : (
          <>
            <div
              class="eval-bar-fill eval-bar-fill--light"
              style={{ height: whiteHeight }}
            />
            <div
              class="eval-bar-fill eval-bar-fill--dark"
              style={{ height: blackHeight }}
            />
          </>
        )}
      </div>
      <div class="eval-bar-label">
        {error ? "!" : loading ? "…" : label}
      </div>
    </div>
  );
}
