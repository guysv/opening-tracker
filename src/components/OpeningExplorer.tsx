import { useEffect, useMemo, useState } from "preact/hooks";

import { useExplorerLocation } from "../hooks/useExplorerLocation";
import {
  fetchAggregatedMoves,
  replayMoves,
  startPositionHash,
  type AggregatedMove,
  type ColorFilter,
} from "../lib/explorerData";
import { navigateTo } from "../lib/explorerUrl";
import { ChessBoard } from "./ChessBoard";

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

function ResultBar({ move }: { move: AggregatedMove }) {
  const total = move.wins + move.draws + move.losses;
  if (total === 0) return null;

  const wPct = (move.wins / total) * 100;
  const dPct = (move.draws / total) * 100;
  const lPct = (move.losses / total) * 100;

  return (
    <div class="result-bar">
      {wPct > 0 && <div class="result-bar-win" style={{ width: `${wPct}%` }} />}
      {dPct > 0 && <div class="result-bar-draw" style={{ width: `${dPct}%` }} />}
      {lPct > 0 && <div class="result-bar-loss" style={{ width: `${lPct}%` }} />}
    </div>
  );
}

export function OpeningExplorer() {
  const loc = useExplorerLocation();
  const [moves, setMoves] = useState<AggregatedMove[]>([]);
  const [colorFilter, setColorFilter] = useState<ColorFilter>("both");

  const replay = useMemo(() => replayMoves(loc.via), [loc.via]);

  const posHash = replay.posHash;

  useEffect(() => {
    let cancelled = false;
    fetchAggregatedMoves(posHash, colorFilter).then((result) => {
      if (!cancelled) setMoves(result);
    });
    return () => { cancelled = true; };
  }, [posHash, colorFilter]);

  function handleMoveClick(move: AggregatedMove) {
    navigateTo(move.fenHashAfter, [...loc.via, move.san]);
  }

  function handleBreadcrumbClick(plyIndex: number) {
    if (plyIndex < 0) {
      navigateTo(startPositionHash(), []);
    } else {
      const truncatedVia = loc.via.slice(0, plyIndex + 1);
      const r = replayMoves(truncatedVia);
      navigateTo(r.posHash, truncatedVia);
    }
  }

  const hasResults = moves.some((m) => m.wins + m.draws + m.losses > 0);

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
              onClick={() => setColorFilter(colorFilter === "w" ? "both" : "w")}
            >
              As white
            </button>
            <button
              class={`color-toggle-btn ${colorFilter === "b" ? "color-toggle-btn--active" : ""}`}
              onClick={() => setColorFilter(colorFilter === "b" ? "both" : "b")}
            >
              As black
            </button>
          </div>

          <span class="side-badge">
            {replay.sideToMove === "w" ? "\u25CB" : "\u25CF"}{" "}
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
        <ChessBoard fen={replay.fen} />

        <div class="explorer-moves">
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
                    class="moves-row"
                    onClick={() => handleMoveClick(m)}
                  >
                    <td class="moves-san">{m.san}</td>
                    <td class="moves-games">
                      <span class="moves-count">{m.games}</span>
                    </td>
                    {hasResults && (
                      <td class="moves-result">
                        <ResultBar move={m} />
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
