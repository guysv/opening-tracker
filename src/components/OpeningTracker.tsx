import { useEffect, useMemo, useState } from "preact/hooks";

import { useExplorerLocation } from "../hooks/useExplorerLocation";
import {
  fetchPositionData,
  filterPositionData,
  previewHoveredMove,
  replayMoves,
  startPositionHash,
  type AggregatedMove,
  type ColorFilter,
  type EloRange,
  type PositionData,
  type ReplayResult,
} from "../lib/explorerData";
import { getStockfishEval, upsertStockfishEval } from "../lib/dbClient";
import {
  analyzePosition,
  formatMoveEvalDiff,
  moveEvalDiffAdvantage,
  type MoveEvalDiffAdvantage,
  type StockfishDisplayEval,
} from "../lib/stockfishEval";
import { navigateTo } from "../lib/explorerUrl";
import { ChessBoard } from "./ChessBoard";
import { EvalBar } from "./EvalBar";

function formatBreadcrumbLabel(san: string, ply: number): string {
  const moveNum = Math.floor(ply / 2) + 1;
  return ply % 2 === 0 ? `${moveNum}. ${san}` : `${moveNum}... ${san}`;
}

function chessComAnalysisUrl(fen: string): string {
  return `https://www.chess.com/analysis?fen=${encodeURIComponent(fen)}`;
}

function winPct(m: AggregatedMove): string | null {
  const decided = m.wins + m.draws + m.losses;
  if (decided === 0) return null;
  return `${Math.round((m.wins / decided) * 100)}%`;
}

function ResultBar({ move, maxGames, fullWidth }: { move: AggregatedMove; maxGames: number; fullWidth?: boolean }) {
  const total = move.wins + move.draws + move.losses;
  if (total === 0) return null;

  const barWidthPct = fullWidth ? 100 : (maxGames > 0 ? (move.games / maxGames) * 100 : 100);
  const mateWinPct = (move.mateWins / total) * 100;
  const trapWinPct = (move.trapWins / total) * 100;
  const plainWinPct = ((move.wins - move.trapWins - move.mateWins) / total) * 100;
  const dPct = (move.draws / total) * 100;
  const lPct = (move.losses / total) * 100;

  return (
    <div class="result-bar" style={{ width: `${barWidthPct}%` }}>
      {mateWinPct > 0 && <div class="result-bar-mate-win" style={{ width: `${mateWinPct}%` }} />}
      {plainWinPct > 0 && <div class="result-bar-win" style={{ width: `${plainWinPct}%` }} />}
      {trapWinPct > 0 && <div class="result-bar-trap-win" style={{ width: `${trapWinPct}%` }} />}
      {dPct > 0 && <div class="result-bar-draw" style={{ width: `${dPct}%` }} />}
      {lPct > 0 && <div class="result-bar-loss" style={{ width: `${lPct}%` }} />}
    </div>
  );
}

type MoveEvalDiffEntry =
  | { status: "pending" }
  | { status: "ready"; text: string; advantage: MoveEvalDiffAdvantage }
  | { status: "error" };

function moveEvalDiffLabel(entry: MoveEvalDiffEntry | undefined): string {
  if (entry == null || entry.status === "pending") return "...";
  if (entry.status === "error") return "!";
  return entry.text;
}

function moveEvalDiffPending(entry: MoveEvalDiffEntry | undefined): boolean {
  return entry == null || entry.status === "pending";
}

function moveEvalDiffClass(entry: MoveEvalDiffEntry | undefined): string {
  const base = "moves-san-eval";
  if (entry == null || entry.status === "pending") {
    return `${base} moves-san-eval--pending`;
  }
  if (entry.status === "error") {
    return `${base} moves-san-eval--error`;
  }
  if (entry.advantage === "white") {
    return `${base} moves-san-eval--w-adv`;
  }
  if (entry.advantage === "black") {
    return `${base} moves-san-eval--b-adv`;
  }
  return `${base} moves-san-eval--neutral`;
}

type OpeningTrackerProps = {
  eloRange: EloRange;
  expandResultBars: boolean;
  gamesDataRevision: number;
};

export function OpeningTracker({ eloRange, expandResultBars, gamesDataRevision }: OpeningTrackerProps) {
  const loc = useExplorerLocation();
  const [posData, setPosData] = useState<PositionData | null>(null);
  const colorFilter = loc.color;
  const [previewSan, setPreviewSan] = useState<string | null>(null);
  const [sfEval, setSfEval] = useState<StockfishDisplayEval | null>(null);
  const [sfLoading, setSfLoading] = useState(false);
  const [sfError, setSfError] = useState(false);
  const [hoverSfEval, setHoverSfEval] = useState<StockfishDisplayEval | null>(null);
  const [hoverSfLoading, setHoverSfLoading] = useState(false);
  const [hoverSfError, setHoverSfError] = useState(false);
  const [moveEvalDiffs, setMoveEvalDiffs] = useState<Record<string, MoveEvalDiffEntry>>({});

  const replay = useMemo(() => replayMoves(loc.via), [loc.via]);

  const hoverPreview = useMemo(() => {
    if (!previewSan || replay.error) return null;
    return previewHoveredMove(loc.via, previewSan);
  }, [previewSan, loc.via, replay.error]);

  const hoverReplay = useMemo((): ReplayResult | null => {
    if (!previewSan || replay.error) return null;
    const r = replayMoves([...loc.via, previewSan]);
    return r.error ? null : r;
  }, [previewSan, loc.via, replay.error]);

  const posHash = replay.posHash;

  useEffect(() => {
    setPreviewSan(null);
  }, [loc.via]);

  useEffect(() => {
    let cancelled = false;
    fetchPositionData(posHash).then((data) => {
      if (!cancelled) setPosData(data);
    });
    return () => { cancelled = true; };
  }, [posHash, gamesDataRevision]);

  useEffect(() => {
    if (replay.error) {
      setSfEval(null);
      setSfLoading(false);
      setSfError(false);
      return;
    }

    const ac = new AbortController();
    let cancelled = false;

    setSfEval(null);
    setSfError(false);
    setSfLoading(true);

    (async () => {
      const cached = await getStockfishEval(replay.posHash);
      if (cancelled) return;
      if (cached) {
        setSfEval({
          kind: cached.kind,
          cp: cached.cp,
          mate: cached.mate,
          depth: cached.depth,
        });
        setSfLoading(false);
        return;
      }

      try {
        const result = await analyzePosition(replay.fen, ac.signal);
        if (cancelled) return;
        await upsertStockfishEval({
          fen_hash: replay.posHash,
          kind: result.kind,
          cp: result.cp,
          mate: result.mate,
          depth: result.depth,
          evaluated_at: Date.now(),
        });
        setSfEval(result);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setSfError(true);
        setSfEval(null);
      } finally {
        if (!cancelled) setSfLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [replay.posHash, replay.fen, replay.error]);

  useEffect(() => {
    if (!hoverReplay) {
      setHoverSfEval(null);
      setHoverSfLoading(false);
      setHoverSfError(false);
      return;
    }

    const ac = new AbortController();
    let cancelled = false;

    setHoverSfEval(null);
    setHoverSfError(false);
    setHoverSfLoading(true);

    (async () => {
      const cached = await getStockfishEval(hoverReplay.posHash);
      if (cancelled) return;
      if (cached) {
        setHoverSfEval({
          kind: cached.kind,
          cp: cached.cp,
          mate: cached.mate,
          depth: cached.depth,
        });
        setHoverSfLoading(false);
        return;
      }

      try {
        const result = await analyzePosition(hoverReplay.fen, ac.signal);
        if (cancelled) return;
        await upsertStockfishEval({
          fen_hash: hoverReplay.posHash,
          kind: result.kind,
          cp: result.cp,
          mate: result.mate,
          depth: result.depth,
          evaluated_at: Date.now(),
        });
        setHoverSfEval(result);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setHoverSfError(true);
        setHoverSfEval(null);
      } finally {
        if (!cancelled) setHoverSfLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [hoverReplay?.posHash, hoverReplay?.fen]);

  const eloMin = eloRange[0];
  const eloMax = eloRange[1];

  const moves = useMemo<AggregatedMove[]>(() => {
    if (!posData) return [];
    const range: EloRange | null =
      eloMin === 0 && eloMax === 3500 ? null : [eloMin, eloMax];
    return filterPositionData(posData, colorFilter, range);
  }, [posData, colorFilter, eloMin, eloMax]);

  useEffect(() => {
    if (replay.error || moves.length === 0) {
      setMoveEvalDiffs({});
      return;
    }

    if (sfLoading || !sfEval || sfError) {
      setMoveEvalDiffs(
        Object.fromEntries(moves.map((m) => [m.fenHashAfter, { status: "pending" as const }])),
      );
      return;
    }

    const parent = sfEval;
    let cancelled = false;
    const ac = new AbortController();

    setMoveEvalDiffs(
      Object.fromEntries(moves.map((m) => [m.fenHashAfter, { status: "pending" as const }])),
    );

    (async () => {
      for (const m of moves) {
        if (cancelled) return;

        const preview = previewHoveredMove(loc.via, m.san);
        if (!preview) {
          setMoveEvalDiffs((prev) => ({
            ...prev,
            [m.fenHashAfter]: { status: "ready", text: "—", advantage: "neutral" },
          }));
          continue;
        }

        let child: StockfishDisplayEval | null = null;
        const cached = await getStockfishEval(m.fenHashAfter);
        if (cancelled) return;

        if (cached) {
          child = {
            kind: cached.kind,
            cp: cached.cp,
            mate: cached.mate,
            depth: cached.depth,
          };
        } else {
          try {
            child = await analyzePosition(preview.fen, ac.signal);
            if (cancelled) return;
            await upsertStockfishEval({
              fen_hash: m.fenHashAfter,
              kind: child.kind,
              cp: child.cp,
              mate: child.mate,
              depth: child.depth,
              evaluated_at: Date.now(),
            });
          } catch (e) {
            if (cancelled) return;
            if (e instanceof DOMException && e.name === "AbortError") return;
            setMoveEvalDiffs((prev) => ({
              ...prev,
              [m.fenHashAfter]: { status: "error" },
            }));
            continue;
          }
        }

        if (cancelled || !child) return;
        const text = formatMoveEvalDiff(parent, child);
        const advantage = moveEvalDiffAdvantage(parent, child);
        setMoveEvalDiffs((prev) => ({
          ...prev,
          [m.fenHashAfter]: { status: "ready", text, advantage },
        }));
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [loc.via, moves, replay.error, sfError, sfEval, sfLoading]);

  function handleMoveClick(move: AggregatedMove) {
    navigateTo(move.fenHashAfter, [...loc.via, move.san], colorFilter);
  }

  function handleBreadcrumbClick(plyIndex: number) {
    if (plyIndex < 0) {
      navigateTo(startPositionHash(), [], colorFilter);
    } else {
      const truncatedVia = loc.via.slice(0, plyIndex + 1);
      const r = replayMoves(truncatedVia);
      navigateTo(r.posHash, truncatedVia, colorFilter);
    }
  }

  function setColorFilter(next: ColorFilter) {
    if (next === colorFilter) return;
    navigateTo(replay.posHash, loc.via, next, { replace: true });
  }

  const hasResults = moves.some((m) => m.wins + m.draws + m.losses > 0);
  const maxGames = moves.reduce((max, m) => Math.max(max, m.games), 0);

  return (
    <main class="explorer">
      <div class="explorer-breadcrumbs">
        <button
          class={`breadcrumb ${loc.via.length === 0 ? "breadcrumb--active" : ""}`}
          onClick={() => handleBreadcrumbClick(-1)}
        >
          Start
        </button>
        {loc.via.map((san, i) => (
          <span key={i}>
            <span class="breadcrumb-sep">{"\u203A"}</span>
            <button
              class={`breadcrumb ${i === loc.via.length - 1 ? "breadcrumb--active" : ""}`}
              onClick={() => handleBreadcrumbClick(i)}
            >
              {formatBreadcrumbLabel(san, i)}
            </button>
          </span>
        ))}
      </div>

      <div class="explorer-header">
        <div class="explorer-header-left">
          <div class="color-toggle">
            <button
              class={`color-toggle-btn ${colorFilter === "w" ? "color-toggle-btn--active" : ""}`}
              onClick={() => setColorFilter("w")}
            >
              As white
            </button>
            <button
              class={`color-toggle-btn ${colorFilter === "b" ? "color-toggle-btn--active" : ""}`}
              onClick={() => setColorFilter("b")}
            >
              As black
            </button>
          </div>

          <span class="side-badge">
            <span
              class={`turn-dot ${replay.sideToMove === "w" ? "turn-dot--white" : "turn-dot--black"}`}
              aria-hidden
            />
            {replay.sideToMove === "w" ? "White" : "Black"} to move
          </span>
        </div>
        <a
          class="analyze-link"
          href={chessComAnalysisUrl(replay.fen)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Analyze on chess.com ↗
        </a>
      </div>

      <div class="explorer-body">
        <div class="board-column">
          <EvalBar
            evalData={hoverReplay ? hoverSfEval : sfEval}
            loading={hoverReplay ? hoverSfLoading : sfLoading}
            error={hoverReplay ? hoverSfError : sfError}
          />
          <ChessBoard
            fen={hoverPreview?.fen ?? replay.fen}
            flipped={colorFilter === "b"}
            highlightFrom={hoverPreview?.fromSq ?? null}
            highlightTo={hoverPreview?.toSq ?? null}
          />
        </div>

        <div
          class="explorer-moves"
          onMouseLeave={(e) => {
            const next = e.relatedTarget as Node | null;
            if (next && e.currentTarget.contains(next)) return;
            setPreviewSan(null);
          }}
        >
          {replay.error ? (
            <p class="explorer-error">
              Replay failed on move: <strong>{replay.error}</strong>
            </p>
          ) : null}

          {moves.length === 0 ? (
            <p class="explorer-empty">No moves found for this position.</p>
          ) : (
            <table class="moves-table">
              <thead>
                <tr>
                  <th>Move</th>
                  <th>Games</th>
                  {hasResults && <th>Result</th>}
                  {hasResults && <th class="th-right">Win %</th>}
                </tr>
              </thead>
              <tbody>
                {moves.map((m) => (
                  <tr
                    key={m.san}
                    class={`moves-row ${previewSan === m.san ? "moves-row--preview" : ""}`}
                    onClick={() => handleMoveClick(m)}
                    onMouseEnter={() => setPreviewSan(m.san)}
                  >
                    <td class="moves-san">
                      <span class="moves-san-name">{m.san}</span>
                      <span
                        class={moveEvalDiffClass(moveEvalDiffs[m.fenHashAfter])}
                      >
                        {moveEvalDiffLabel(moveEvalDiffs[m.fenHashAfter])}
                      </span>
                    </td>
                    <td class="moves-games">
                      <span class="moves-count">{m.games}</span>
                    </td>
                    {hasResults && (
                      <td class="moves-result">
                        <ResultBar move={m} maxGames={maxGames} fullWidth={expandResultBars} />
                      </td>
                    )}
                    {hasResults && (
                      <td class="moves-winpct">{winPct(m) ?? "—"}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}
