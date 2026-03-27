import { Fragment } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import pkg from "../../package.json";

import { useExplorerLocation } from "../hooks/useExplorerLocation";
import {
  fetchPositionData,
  filterPositionData,
  listGamesForMove,
  previewHoveredMove,
  replayMoves,
  startPositionHash,
  type AggregatedMove,
  type ColorFilter,
  type EloRange,
  type MoveGameListItem,
  type PositionData,
  type ReplayResult,
} from "../lib/explorerData";
import { defaultBookmarkNameFromVia } from "../lib/bookmarkLabel";
import {
  addBookmark,
  getStockfishEval,
  listBookmarks,
  removeBookmark,
  upsertStockfishEval,
} from "../lib/dbClient";
import {
  analyzePosition,
  formatMoveEvalDiff,
  moveEvalDiffAdvantage,
  moveIsMoverBlunder,
  type MoveEvalDiffAdvantage,
  type StockfishDisplayEval,
} from "../lib/stockfishEval";
import { buildFragment, navigateTo } from "../lib/explorerUrl";
import { ChessBoard } from "./ChessBoard";
import { EvalBar } from "./EvalBar";
import { MoveResultBar } from "./MoveResultBar";

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

function outcomeShort(o: MoveGameListItem["outcome"]): string {
  if (o === "win") return "W";
  if (o === "draw") return "D";
  if (o === "loss") return "L";
  return "—";
}

function outcomeClass(o: MoveGameListItem["outcome"]): string {
  if (o === "win") return "moves-game-outcome moves-game-outcome--win";
  if (o === "draw") return "moves-game-outcome moves-game-outcome--draw";
  if (o === "loss") return "moves-game-outcome moves-game-outcome--loss";
  return "moves-game-outcome moves-game-outcome--na";
}

function formatPlayerSide(name: string, rating: number | null): string {
  return rating != null ? `${name} (${rating})` : name;
}

type MoveEvalDiffEntry =
  | { status: "pending" }
  | { status: "ready"; text: string; advantage: MoveEvalDiffAdvantage; blunder: boolean }
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
  /** When set, only moves for these tracked users; `undefined` = no filter (all rows). */
  includeUsernames?: string[];
  bookmarksRevision: number;
  onBookmarkToggle: () => void;
  bookmarkPreview?: { fen: string; posHash: string; sideToMove: "w" | "b" } | null;
};

export function OpeningTracker({
  eloRange,
  expandResultBars,
  gamesDataRevision,
  includeUsernames,
  bookmarksRevision,
  onBookmarkToggle,
  bookmarkPreview,
}: OpeningTrackerProps) {
  const loc = useExplorerLocation();
  const [posData, setPosData] = useState<PositionData | null>(null);
  const colorFilter = loc.color;
  const [previewSan, setPreviewSan] = useState<string | null>(null);
  const [hoverAnimationHints, setHoverAnimationHints] = useState<{ from: string; to: string }[] | null>(null);
  const [breadcrumbPreviewPly, setBreadcrumbPreviewPly] = useState<number | null>(null);
  const [expandedSan, setExpandedSan] = useState<string | null>(null);
  const [sfEval, setSfEval] = useState<StockfishDisplayEval | null>(null);
  const [sfLoading, setSfLoading] = useState(false);
  const [sfError, setSfError] = useState(false);
  const [hoverSfEval, setHoverSfEval] = useState<StockfishDisplayEval | null>(null);
  const [hoverSfLoading, setHoverSfLoading] = useState(false);
  const [hoverSfError, setHoverSfError] = useState(false);
  const [bookmarkSfEval, setBookmarkSfEval] = useState<StockfishDisplayEval | null>(null);
  const [bookmarkSfLoading, setBookmarkSfLoading] = useState(false);
  const [bookmarkSfError, setBookmarkSfError] = useState(false);
  const [breadcrumbSfEval, setBreadcrumbSfEval] = useState<StockfishDisplayEval | null>(null);
  const [breadcrumbSfLoading, setBreadcrumbSfLoading] = useState(false);
  const [breadcrumbSfError, setBreadcrumbSfError] = useState(false);
  const [moveEvalDiffs, setMoveEvalDiffs] = useState<Record<string, MoveEvalDiffEntry>>({});

  const replay = useMemo(() => replayMoves(loc.via), [loc.via]);
  const breadcrumbPreviewReplay = useMemo((): ReplayResult | null => {
    if (breadcrumbPreviewPly == null) return null;
    const previewVia = breadcrumbPreviewPly < 0 ? [] : loc.via.slice(0, breadcrumbPreviewPly + 1);
    const r = replayMoves(previewVia);
    return r.error ? null : r;
  }, [breadcrumbPreviewPly, loc.via]);
  const displaySideToMove =
    bookmarkPreview?.sideToMove ?? breadcrumbPreviewReplay?.sideToMove ?? replay.sideToMove;

  const hoverPreview = useMemo(() => {
    if (!previewSan || replay.error) return null;
    return previewHoveredMove(loc.via, previewSan);
  }, [previewSan, loc.via, replay.error]);

  const handleMoveRowEnter = (san: string) => {
    const nextPreview = previewHoveredMove(loc.via, san);
    if (
      hoverPreview &&
      nextPreview &&
      hoverPreview.fromSq &&
      hoverPreview.toSq &&
      nextPreview.fromSq &&
      nextPreview.toSq
    ) {
      setHoverAnimationHints([
        { from: hoverPreview.toSq, to: hoverPreview.fromSq },
        { from: nextPreview.fromSq, to: nextPreview.toSq },
      ]);
    } else {
      setHoverAnimationHints(null);
    }
    setPreviewSan(san);
  };

  const hoverReplay = useMemo((): ReplayResult | null => {
    if (!previewSan || replay.error) return null;
    const r = replayMoves([...loc.via, previewSan]);
    return r.error ? null : r;
  }, [previewSan, loc.via, replay.error]);

  const posHash = replay.posHash;

  const viaKey = loc.via.join("\0");
  const bookmarkFragment = useMemo(
    () => buildFragment(replay.posHash, loc.via, colorFilter),
    [replay.posHash, viaKey, colorFilter],
  );

  const [starred, setStarred] = useState(false);
  const [bookmarkAddMode, setBookmarkAddMode] = useState(false);
  const [bookmarkNameDraft, setBookmarkNameDraft] = useState("");
  const bookmarkNameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    listBookmarks().then((rows) => {
      if (!cancelled) setStarred(rows.some((r) => r.fragment === bookmarkFragment));
    });
    return () => {
      cancelled = true;
    };
  }, [bookmarkFragment, bookmarksRevision]);

  useEffect(() => {
    setBookmarkAddMode(false);
  }, [bookmarkFragment]);

  useEffect(() => {
    if (!bookmarkAddMode || starred) return;
    const el = bookmarkNameInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [bookmarkAddMode, starred]);

  useEffect(() => {
    setPreviewSan(null);
    setHoverAnimationHints(null);
  }, [loc.via]);

  useEffect(() => {
    setBreadcrumbPreviewPly(null);
  }, [loc.via]);

  useEffect(() => {
    setExpandedSan(null);
  }, [posHash]);

  const includeKey =
    includeUsernames === undefined ? "\0__all__" : includeUsernames.join("\0");

  useEffect(() => {
    let cancelled = false;
    fetchPositionData(
      posHash,
      includeUsernames === undefined ? undefined : includeUsernames,
    ).then((data) => {
      if (!cancelled) setPosData(data);
    });
    return () => {
      cancelled = true;
    };
  }, [posHash, gamesDataRevision, includeKey]);

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

  useEffect(() => {
    if (!bookmarkPreview) {
      setBookmarkSfEval(null);
      setBookmarkSfLoading(false);
      setBookmarkSfError(false);
      return;
    }

    const ac = new AbortController();
    let cancelled = false;

    setBookmarkSfEval(null);
    setBookmarkSfError(false);
    setBookmarkSfLoading(true);

    (async () => {
      const cached = await getStockfishEval(bookmarkPreview.posHash);
      if (cancelled) return;
      if (cached) {
        setBookmarkSfEval({
          kind: cached.kind,
          cp: cached.cp,
          mate: cached.mate,
          depth: cached.depth,
        });
        setBookmarkSfLoading(false);
        return;
      }

      try {
        const result = await analyzePosition(bookmarkPreview.fen, ac.signal);
        if (cancelled) return;
        await upsertStockfishEval({
          fen_hash: bookmarkPreview.posHash,
          kind: result.kind,
          cp: result.cp,
          mate: result.mate,
          depth: result.depth,
          evaluated_at: Date.now(),
        });
        setBookmarkSfEval(result);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setBookmarkSfError(true);
        setBookmarkSfEval(null);
      } finally {
        if (!cancelled) setBookmarkSfLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [bookmarkPreview?.posHash, bookmarkPreview?.fen]);

  useEffect(() => {
    if (!breadcrumbPreviewReplay) {
      setBreadcrumbSfEval(null);
      setBreadcrumbSfLoading(false);
      setBreadcrumbSfError(false);
      return;
    }

    const ac = new AbortController();
    let cancelled = false;

    setBreadcrumbSfEval(null);
    setBreadcrumbSfError(false);
    setBreadcrumbSfLoading(true);

    (async () => {
      const cached = await getStockfishEval(breadcrumbPreviewReplay.posHash);
      if (cancelled) return;
      if (cached) {
        setBreadcrumbSfEval({
          kind: cached.kind,
          cp: cached.cp,
          mate: cached.mate,
          depth: cached.depth,
        });
        setBreadcrumbSfLoading(false);
        return;
      }

      try {
        const result = await analyzePosition(breadcrumbPreviewReplay.fen, ac.signal);
        if (cancelled) return;
        await upsertStockfishEval({
          fen_hash: breadcrumbPreviewReplay.posHash,
          kind: result.kind,
          cp: result.cp,
          mate: result.mate,
          depth: result.depth,
          evaluated_at: Date.now(),
        });
        setBreadcrumbSfEval(result);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setBreadcrumbSfError(true);
        setBreadcrumbSfEval(null);
      } finally {
        if (!cancelled) setBreadcrumbSfLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [breadcrumbPreviewReplay?.posHash, breadcrumbPreviewReplay?.fen]);

  const eloMin = eloRange[0];
  const eloMax = eloRange[1];
  const eloRangeForFilter = useMemo((): EloRange | null => {
    return eloMin === 0 && eloMax === 3500 ? null : [eloMin, eloMax];
  }, [eloMin, eloMax]);

  const moves = useMemo<AggregatedMove[]>(() => {
    if (!posData) return [];
    return filterPositionData(posData, colorFilter, eloRangeForFilter);
  }, [posData, colorFilter, eloRangeForFilter]);

  const expandedGames = useMemo((): MoveGameListItem[] => {
    if (!posData || !expandedSan) return [];
    return listGamesForMove(posData, expandedSan, colorFilter, eloRangeForFilter);
  }, [posData, expandedSan, colorFilter, eloRangeForFilter]);

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
            [m.fenHashAfter]: { status: "ready", text: "—", advantage: "neutral", blunder: false },
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
        const blunder = moveIsMoverBlunder(parent, child, replay.sideToMove);
        setMoveEvalDiffs((prev) => ({
          ...prev,
          [m.fenHashAfter]: { status: "ready", text, advantage, blunder },
        }));
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [loc.via, moves, replay.error, replay.sideToMove, sfError, sfEval, sfLoading]);

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

  async function confirmBookmarkAdd() {
    if (replay.error) return;
    try {
      await addBookmark(bookmarkFragment, bookmarkNameDraft);
      setStarred(true);
      setBookmarkAddMode(false);
      onBookmarkToggle();
    } catch {
      /* ignore bookmark errors */
    }
  }

  function handleBookmarkStarButton() {
    if (replay.error) return;
    if (starred) {
      void (async () => {
        try {
          await removeBookmark(bookmarkFragment);
          setStarred(false);
          setBookmarkAddMode(false);
          onBookmarkToggle();
        } catch {
          /* ignore */
        }
      })();
      return;
    }
    setBookmarkNameDraft(defaultBookmarkNameFromVia(loc.via));
    setBookmarkAddMode(true);
  }

  const hasResults = moves.some((m) => m.wins + m.draws + m.losses > 0);
  const maxGames = moves.reduce((max, m) => Math.max(max, m.games), 0);
  const moveTableColSpan = 2 + (hasResults ? 2 : 0);

  return (
    <main class="explorer">
      <div class="explorer-title-row">
        <span class="explorer-title">Opening Tracker</span>
        <span class="explorer-version">v{pkg.version}</span>
      </div>

      <div
        class="explorer-breadcrumbs"
        onMouseLeave={() => setBreadcrumbPreviewPly(null)}
      >
        <button
          class={`breadcrumb ${loc.via.length === 0 ? "breadcrumb--active" : ""} ${breadcrumbPreviewPly === -1 ? "moves-row--preview" : ""}`}
          onClick={() => handleBreadcrumbClick(-1)}
          onMouseEnter={() => setBreadcrumbPreviewPly(-1)}
        >
          Start
        </button>
        {loc.via.map((san, i) => (
          <span key={i}>
            <span class="breadcrumb-sep">{"\u203A"}</span>
            <button
              class={`breadcrumb ${i === loc.via.length - 1 ? "breadcrumb--active" : ""} ${breadcrumbPreviewPly === i ? "moves-row--preview" : ""}`}
              onClick={() => handleBreadcrumbClick(i)}
              onMouseEnter={() => setBreadcrumbPreviewPly(i)}
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
              class={`turn-dot ${displaySideToMove === "w" ? "turn-dot--white" : "turn-dot--black"}`}
              aria-hidden
            />
            {displaySideToMove === "w" ? "White" : "Black"} to move
          </span>
        </div>
        <div class="explorer-header-right">
          {bookmarkAddMode && !starred ? (
            <>
              <input
                ref={bookmarkNameInputRef}
                class="bookmark-add-name-input"
                type="text"
                value={bookmarkNameDraft}
                placeholder="Bookmark name"
                aria-label="Bookmark name"
                onInput={(e) => setBookmarkNameDraft((e.currentTarget as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setBookmarkAddMode(false);
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void confirmBookmarkAdd();
                  }
                }}
              />
              <button
                type="button"
                class="bookmark-confirm-btn"
                aria-label="Save bookmark"
                onClick={() => void confirmBookmarkAdd()}
              >
                ✓
              </button>
            </>
          ) : (
            <button
              type="button"
              class={`bookmark-star-btn ${starred ? "bookmark-star-btn--on" : ""}`}
              disabled={!!replay.error}
              aria-pressed={starred}
              aria-label={
                starred ? "Remove bookmark for this position" : "Add bookmark for this position"
              }
              onClick={handleBookmarkStarButton}
            >
              {starred ? "★" : "☆"}
            </button>
          )}
          <a
            class="analyze-link"
            href={chessComAnalysisUrl(replay.fen)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Analyze on chess.com ↗
          </a>
        </div>
      </div>

      <div class="explorer-body">
        <div class="board-column">
          <EvalBar
            evalData={
              bookmarkPreview
                ? bookmarkSfEval
                : breadcrumbPreviewReplay
                  ? breadcrumbSfEval
                  : hoverReplay
                    ? hoverSfEval
                    : sfEval
            }
            loading={
              bookmarkPreview
                ? bookmarkSfLoading
                : breadcrumbPreviewReplay
                  ? breadcrumbSfLoading
                  : hoverReplay
                    ? hoverSfLoading
                    : sfLoading
            }
            error={
              bookmarkPreview
                ? bookmarkSfError
                : breadcrumbPreviewReplay
                  ? breadcrumbSfError
                  : hoverReplay
                    ? hoverSfError
                    : sfError
            }
            perspective={colorFilter}
          />
          <ChessBoard
            fen={bookmarkPreview?.fen ?? breadcrumbPreviewReplay?.fen ?? hoverPreview?.fen ?? replay.fen}
            flipped={colorFilter === "b"}
            highlightFrom={bookmarkPreview || breadcrumbPreviewReplay ? null : (hoverPreview?.fromSq ?? null)}
            highlightTo={bookmarkPreview || breadcrumbPreviewReplay ? null : (hoverPreview?.toSq ?? null)}
            animationHints={bookmarkPreview || breadcrumbPreviewReplay ? null : hoverAnimationHints}
          />
        </div>

        <div
          class="explorer-moves"
          onMouseLeave={(e) => {
            const next = e.relatedTarget as Node | null;
            if (next && e.currentTarget.contains(next)) return;
            setPreviewSan(null);
            setHoverAnimationHints(null);
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
                {moves.map((m) => {
                  const diff = moveEvalDiffs[m.fenHashAfter];
                  const blunderRow =
                    diff?.status === "ready" && diff.blunder;
                  const isExpanded = expandedSan === m.san;
                  return (
                    <Fragment key={m.san}>
                      <tr
                        class={`moves-row ${previewSan === m.san ? "moves-row--preview" : ""} ${blunderRow ? "moves-row--blunder" : ""}`}
                        onClick={() => handleMoveClick(m)}
                        onMouseEnter={() => handleMoveRowEnter(m.san)}
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
                          <span class="moves-games-inner">
                            <span class="moves-count">{m.games}</span>
                            <button
                              type="button"
                              class={`moves-expand-btn ${isExpanded ? "moves-expand-btn--open" : ""}`}
                              aria-expanded={isExpanded}
                              aria-label={
                                isExpanded
                                  ? "Hide games for this move"
                                  : "Show all games for this move"
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedSan((s) => (s === m.san ? null : m.san));
                              }}
                            >
                              {isExpanded ? "▾" : "▸"}
                            </button>
                          </span>
                        </td>
                        {hasResults && (
                          <td class="moves-result">
                            <MoveResultBar move={m} maxGames={maxGames} fullWidth={expandResultBars} />
                          </td>
                        )}
                        {hasResults && (
                          <td class="moves-winpct">{winPct(m) ?? "—"}</td>
                        )}
                      </tr>
                      {isExpanded ? (
                        <tr class="moves-expand-row">
                          <td class="moves-expand-cell" colSpan={moveTableColSpan}>
                            <ul class="moves-game-list">
                              {expandedGames.map((g) => (
                                <li key={g.gameId} class="moves-game-item">
                                  <span class={outcomeClass(g.outcome)} title="Your result">
                                    {outcomeShort(g.outcome)}
                                  </span>
                                  {g.url ? (
                                    <a
                                      class="moves-game-link"
                                      href={g.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {formatPlayerSide(g.whiteUsername, g.whiteRating)} vs{" "}
                                      {formatPlayerSide(g.blackUsername, g.blackRating)}
                                    </a>
                                  ) : (
                                    <span class="moves-game-link moves-game-link--muted">
                                      {formatPlayerSide(g.whiteUsername, g.whiteRating)} vs{" "}
                                      {formatPlayerSide(g.blackUsername, g.blackRating)}
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}
