import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { useExplorerLocation } from "../hooks/useExplorerLocation";
import {
  defaultBookmarkNameFromVia,
  truncateBookmarkTitle,
} from "../lib/bookmarkLabel";
import {
  effectiveDateFilter,
  fetchPositionData,
  filterPositionData,
  positionTotalsFromMoves,
  replayMoves,
  type AggregatedMove,
  type DateRangeSec,
  type EloRange,
} from "../lib/explorerData";
import { buildFragment, navigateTo, parseFragment } from "../lib/explorerUrl";
import {
  listBookmarks,
  removeBookmark,
  setBookmarkName,
  type BookmarkRow,
} from "../lib/dbClient";

import { MoveResultBar } from "./MoveResultBar";

function displayBookmarkTitle(row: BookmarkRow, via: string[]): string {
  const raw = row.name.trim() ? row.name : defaultBookmarkNameFromVia(via);
  return truncateBookmarkTitle(raw);
}

type CardModel = {
  row: BookmarkRow;
  displayTitle: string;
  colorLabel: string;
  totals: AggregatedMove;
  parseOk: boolean;
  previewFen: string | null;
  previewPosHash: string | null;
  previewSideToMove: "w" | "b" | null;
};

type BookmarkSidebarProps = {
  dateBoundsSec: DateRangeSec | null;
  dateRangeSec: DateRangeSec | null;
  eloRange: EloRange;
  gamesDataRevision: number;
  bookmarksRevision: number;
  includeUsernames?: string[];
  onBookmarksChanged: () => void;
  onPreviewChange: (preview: { fen: string; posHash: string; sideToMove: "w" | "b" } | null) => void;
  /** When true, another tab holds the DB; do not list bookmarks. */
  dbInUse?: boolean;
  /** When false, panel is a narrow strip with only the toggle. */
  expanded?: boolean;
  onToggleExpanded: () => void;
};

export function BookmarkSidebar({
  dateBoundsSec,
  dateRangeSec,
  eloRange,
  gamesDataRevision,
  bookmarksRevision,
  includeUsernames,
  onBookmarksChanged,
  onPreviewChange,
  dbInUse = false,
  expanded = true,
  onToggleExpanded,
}: BookmarkSidebarProps) {
  const explorerLoc = useExplorerLocation();
  const replay = useMemo(() => replayMoves(explorerLoc.via), [explorerLoc.via]);
  const currentFragment = useMemo(
    () => buildFragment(replay.posHash, explorerLoc.via, explorerLoc.color),
    [replay.posHash, explorerLoc.via.join("\0"), explorerLoc.color],
  );

  const [cards, setCards] = useState<CardModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [renamingFragment, setRenamingFragment] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const suppressRenameBlurRef = useRef(false);

  const includeKey =
    includeUsernames === undefined ? "\0__all__" : includeUsernames.join("\0");

  const dateRangeForFilter = useMemo(
    () => effectiveDateFilter(dateRangeSec, dateBoundsSec),
    [dateRangeSec, dateBoundsSec],
  );

  useEffect(() => {
    if (dbInUse) {
      setCards([]);
      setLoading(false);
      onPreviewChange(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const rows = await listBookmarks();
        const models: CardModel[] = [];

        for (const row of rows) {
          const parsed = parseFragment(row.fragment);
          const r = replayMoves(parsed.via);
          const parseOk = !r.error;
          let totals: AggregatedMove = {
            san: "",
            games: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            trapWins: 0,
            mateWins: 0,
            fenHashAfter: "",
          };
          if (parseOk) {
            const data = await fetchPositionData(
              parsed.posHash,
              includeUsernames === undefined ? undefined : includeUsernames,
            );
            const moves = filterPositionData(data, parsed.color, eloRange, dateRangeForFilter);
            totals = positionTotalsFromMoves(moves);
          }

          models.push({
            row,
            displayTitle: displayBookmarkTitle(row, parsed.via),
            colorLabel: parsed.color === "b" ? "As black" : "As white",
            totals,
            parseOk,
            previewFen: parseOk ? r.fen : null,
            previewPosHash: parseOk ? parsed.posHash : null,
            previewSideToMove: parseOk ? r.sideToMove : null,
          });
        }

        if (!cancelled) setCards(models);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    dbInUse,
    bookmarksRevision,
    gamesDataRevision,
    includeKey,
    eloRange[0],
    eloRange[1],
    dateRangeSec?.[0],
    dateRangeSec?.[1],
    dateBoundsSec?.[0],
    dateBoundsSec?.[1],
    onPreviewChange,
  ]);

  useEffect(() => {
    return () => onPreviewChange(null);
  }, [onPreviewChange]);

  useEffect(() => {
    if (!expanded) onPreviewChange(null);
  }, [expanded, onPreviewChange]);

  useEffect(() => {
    if (renamingFragment == null) return;
    const el = renameInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [renamingFragment]);

  useEffect(() => {
    if (!cards.some((c) => c.row.fragment === renamingFragment)) {
      setRenamingFragment(null);
    }
  }, [cards, renamingFragment]);

  function beginRename(c: CardModel) {
    const parsed = parseFragment(c.row.fragment);
    setRenameDraft(
      c.row.name.trim() ? c.row.name : defaultBookmarkNameFromVia(parsed.via),
    );
    setRenamingFragment(c.row.fragment);
  }

  async function commitRename(fragment: string) {
    try {
      await setBookmarkName(fragment, renameDraft);
      setRenamingFragment(null);
      onBookmarksChanged();
    } catch {
      /* ignore */
    }
  }

  function cancelRename() {
    suppressRenameBlurRef.current = true;
    setRenamingFragment(null);
    queueMicrotask(() => {
      suppressRenameBlurRef.current = false;
    });
  }

  function openBookmark(c: CardModel) {
    if (renamingFragment === c.row.fragment) return;
    const p = parseFragment(c.row.fragment);
    navigateTo(p.posHash, p.via, p.color);
  }

  return (
    <aside
      class={`bookmark-sidebar ${expanded ? "" : "bookmark-sidebar--collapsed"}`}
      aria-label="Bookmarked positions"
    >
      <div class="bookmark-sidebar-header">
        <button
          type="button"
          class="bookmark-sidebar-toggle"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide bookmarks panel" : "Show bookmarks panel"}
          title={expanded ? "Hide bookmarks panel" : "Show bookmarks panel"}
        >
          <span aria-hidden="true">{expanded ? "◀" : "▶"}</span>
        </button>
        <h2 class="bookmark-sidebar-title">Bookmarks</h2>
      </div>
      {loading ? (
        <p class="bookmark-sidebar-status">Loading…</p>
      ) : cards.length === 0 ? (
        <p class="bookmark-sidebar-status">Star a position in the header to save it here.</p>
      ) : (
        <ul class="bookmark-card-list">
          {cards.map((c) => (
            <li key={c.row.fragment}>
              <div
                class={`bookmark-card ${c.row.fragment === currentFragment ? "bookmark-card--current" : ""}`}
                onMouseEnter={() =>
                  onPreviewChange(
                    c.previewFen && c.previewPosHash && c.previewSideToMove
                      ? {
                          fen: c.previewFen,
                          posHash: c.previewPosHash,
                          sideToMove: c.previewSideToMove,
                        }
                      : null,
                  )
                }
                onMouseLeave={() => onPreviewChange(null)}
              >
                <div class="bookmark-card-maincol">
                  {renamingFragment === c.row.fragment ? (
                    <input
                      ref={renameInputRef}
                      class="bookmark-card-rename-input"
                      type="text"
                      value={renameDraft}
                      aria-label="Rename bookmark"
                      onInput={(e) =>
                        setRenameDraft((e.currentTarget as HTMLInputElement).value)
                      }
                      onBlur={() => {
                        if (suppressRenameBlurRef.current) return;
                        void commitRename(c.row.fragment);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          cancelRename();
                        }
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void commitRename(c.row.fragment);
                        }
                      }}
                    />
                  ) : (
                    <div
                      class="bookmark-card-title-row"
                      role="button"
                      tabIndex={0}
                      aria-label={`Open bookmark: ${c.displayTitle}`}
                      onClick={() => openBookmark(c)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openBookmark(c);
                        }
                      }}
                    >
                      <span class="bookmark-card-label">{c.displayTitle}</span>
                      <button
                        type="button"
                        class="bookmark-card-rename"
                        aria-label={`Rename bookmark: ${c.displayTitle}`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          beginRename(c);
                        }}
                      >
                        ✎
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    class="bookmark-card-nav"
                    onClick={() => openBookmark(c)}
                  >
                    <span class="bookmark-card-meta">{c.colorLabel}</span>
                    {!c.parseOk ? (
                      <span class="bookmark-card-strip-fallback">Replay error</span>
                    ) : c.totals.wins + c.totals.draws + c.totals.losses === 0 ? (
                      <span class="bookmark-card-strip-fallback">No games</span>
                    ) : (
                      <div class="bookmark-card-strip">
                        <MoveResultBar
                          move={c.totals}
                          maxGames={c.totals.games}
                          fullWidth
                        />
                      </div>
                    )}
                  </button>
                </div>
                <button
                  type="button"
                  class="bookmark-card-remove"
                  aria-label="Remove bookmark"
                  onClick={(e) => {
                    e.stopPropagation();
                    void (async () => {
                      try {
                        await removeBookmark(c.row.fragment);
                        onBookmarksChanged();
                      } catch {
                        /* ignore */
                      }
                    })();
                  }}
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
