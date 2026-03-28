import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

const PIECE_UNICODE: Record<string, string> = {
  K: "\u265A", Q: "\u265B", R: "\u265C", B: "\u265D", N: "\u265E", P: "\u265F",
  k: "\u265A", q: "\u265B", r: "\u265C", b: "\u265D", n: "\u265E", p: "\u265F",
};

const WHITE_PIECES = new Set(["K", "Q", "R", "B", "N", "P"]);

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const SQUARE_SIZE = 52;
const MOVE_PREVIEW_ANIM_MS = 280;

function parsePlacement(fen: string): (string | null)[][] {
  const placement = fen.split(" ")[0] ?? "";
  const rows: (string | null)[][] = [];

  for (const rank of placement.split("/")) {
    const row: (string | null)[] = [];
    for (const ch of rank) {
      if (ch >= "1" && ch <= "8") {
        for (let i = 0; i < Number(ch); i++) row.push(null);
      } else {
        row.push(ch);
      }
    }
    rows.push(row);
  }

  return rows;
}

type ChessBoardProps = {
  fen: string;
  flipped?: boolean;
  /** Algebraic square (e.g. e2) — last move from (hover preview). */
  highlightFrom?: string | null;
  /** Algebraic square (e.g. e4) — last move to (hover preview). */
  highlightTo?: string | null;
  /** Preferred board transitions to animate when multiple same-piece mappings are possible. */
  animationHints?: { from: string; to: string }[] | null;
};

type Coord = { r: number; f: number };

type MoveAnimation = {
  id: number;
  piece: string;
  from: Coord;
  to: Coord;
};

function parseAlgebraicSquare(sq: string): { r: number; f: number } | null {
  if (sq.length < 2) return null;
  const file = sq.charCodeAt(0) - 97;
  const rank = Number.parseInt(sq.slice(1), 10);
  if (file < 0 || file > 7 || rank < 1 || rank > 8 || Number.isNaN(rank)) return null;
  return { r: 8 - rank, f: file };
}

function boardPieceCoords(rows: (string | null)[][]): Map<string, Coord[]> {
  const out = new Map<string, Coord[]>();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = rows[r]?.[f] ?? null;
      if (!piece) continue;
      const existing = out.get(piece);
      if (existing) existing.push({ r, f });
      else out.set(piece, [{ r, f }]);
    }
  }
  return out;
}

function coordDistance(a: Coord, b: Coord): number {
  return Math.abs(a.r - b.r) + Math.abs(a.f - b.f);
}

function popMatchingCoord(coords: Coord[], target: Coord): boolean {
  const idx = coords.findIndex((c) => c.r === target.r && c.f === target.f);
  if (idx < 0) return false;
  coords.splice(idx, 1);
  return true;
}

function buildTransitions(
  prevRows: (string | null)[][],
  nextRows: (string | null)[][],
  hints: { from: Coord; to: Coord }[] = [],
): Omit<MoveAnimation, "id">[] {
  const transitions: Omit<MoveAnimation, "id">[] = [];
  const prevMap = boardPieceCoords(prevRows);
  const nextMap = boardPieceCoords(nextRows);
  const pieceKinds = new Set([...prevMap.keys(), ...nextMap.keys()]);

  for (const hint of hints) {
    const pieceFrom = prevRows[hint.from.r]?.[hint.from.f] ?? null;
    const pieceTo = nextRows[hint.to.r]?.[hint.to.f] ?? null;
    if (!pieceFrom || pieceFrom !== pieceTo) continue;
    const sources = prevMap.get(pieceFrom) ?? [];
    const targets = nextMap.get(pieceFrom) ?? [];
    if (!popMatchingCoord(sources, hint.from)) continue;
    if (!popMatchingCoord(targets, hint.to)) {
      sources.push(hint.from);
      continue;
    }
    if (hint.from.r !== hint.to.r || hint.from.f !== hint.to.f) {
      transitions.push({ piece: pieceFrom, from: hint.from, to: hint.to });
    }
  }

  for (const piece of pieceKinds) {
    const sources = [...(prevMap.get(piece) ?? [])];
    const targets = [...(nextMap.get(piece) ?? [])];
    while (sources.length > 0 && targets.length > 0) {
      let bestSourceI = 0;
      let bestTargetI = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let si = 0; si < sources.length; si++) {
        for (let ti = 0; ti < targets.length; ti++) {
          const dist = coordDistance(sources[si], targets[ti]);
          if (dist < bestDist) {
            bestDist = dist;
            bestSourceI = si;
            bestTargetI = ti;
          }
        }
      }
      const from = sources.splice(bestSourceI, 1)[0];
      const to = targets.splice(bestTargetI, 1)[0];
      if (from.r !== to.r || from.f !== to.f) transitions.push({ piece, from, to });
    }
  }

  return transitions;
}

export function ChessBoard({
  fen,
  flipped = false,
  highlightFrom = null,
  highlightTo = null,
  animationHints = null,
}: ChessBoardProps) {
  const rows = useMemo(() => parsePlacement(fen), [fen]);
  const fromCoords = useMemo(() => (highlightFrom ? parseAlgebraicSquare(highlightFrom) : null), [highlightFrom]);
  const toCoords = useMemo(() => (highlightTo ? parseAlgebraicSquare(highlightTo) : null), [highlightTo]);
  const parsedAnimationHints = useMemo(() => {
    if (!animationHints || animationHints.length === 0) return [];
    const parsed: { from: Coord; to: Coord }[] = [];
    for (const hint of animationHints) {
      const from = parseAlgebraicSquare(hint.from);
      const to = parseAlgebraicSquare(hint.to);
      if (from && to) parsed.push({ from, to });
    }
    return parsed;
  }, [animationHints]);
  const [moveAnims, setMoveAnims] = useState<MoveAnimation[]>([]);
  const animTimerRef = useRef<number | null>(null);
  const lastAnimIdRef = useRef(0);
  const prevFenRef = useRef<string | null>(null);
  const prevRowsRef = useRef<(string | null)[][] | null>(null);

  useEffect(() => {
    if (animTimerRef.current !== null) {
      window.clearTimeout(animTimerRef.current);
      animTimerRef.current = null;
    }
    return () => {
      if (animTimerRef.current !== null) {
        window.clearTimeout(animTimerRef.current);
        animTimerRef.current = null;
      }
    };
  }, []);

  useLayoutEffect(() => {
    const prevFen = prevFenRef.current;
    const prevRows = prevRowsRef.current;
    prevFenRef.current = fen;
    prevRowsRef.current = rows;
    if (animTimerRef.current !== null) {
      window.clearTimeout(animTimerRef.current);
      animTimerRef.current = null;
    }
    if (!prevFen || prevFen === fen || !prevRows) {
      setMoveAnims((current) => (current.length === 0 ? current : []));
      return;
    }
    const transitions = buildTransitions(prevRows, rows, parsedAnimationHints);
    if (transitions.length === 0) {
      setMoveAnims((current) => (current.length === 0 ? current : []));
      return;
    }
    const nextAnims = transitions.map((t) => {
      lastAnimIdRef.current += 1;
      return { ...t, id: lastAnimIdRef.current };
    });
    setMoveAnims(nextAnims);
    animTimerRef.current = window.setTimeout(() => {
      setMoveAnims([]);
      animTimerRef.current = null;
    }, MOVE_PREVIEW_ANIM_MS);
  }, [fen, rows, parsedAnimationHints]);

  const moveAnimsByFrom = useMemo(() => {
    const map = new Map<string, MoveAnimation[]>();
    for (const anim of moveAnims) {
      const key = `${anim.from.r},${anim.from.f}`;
      const existing = map.get(key);
      if (existing) existing.push(anim);
      else map.set(key, [anim]);
    }
    return map;
  }, [moveAnims]);

  const hiddenSquares = useMemo(() => {
    const set = new Set<string>();
    for (const anim of moveAnims) set.add(`${anim.to.r},${anim.to.f}`);
    return set;
  }, [moveAnims]);

  const rankOrder = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const fileOrder = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const rankLabels = flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const fileLabels = flipped ? [...FILES].reverse() : FILES;

  return (
    <div class="board-wrap">
      <div class="board">
        {rankOrder.map((r, ri) => (
          <div class="board-row" key={ri}>
            <span class="board-rank-label">{rankLabels[ri]}</span>
            {fileOrder.map((f) => {
              const piece = rows[r]?.[f] ?? null;
              const isLight = (r + f) % 2 === 0;
              const hlFrom = fromCoords && fromCoords.r === r && fromCoords.f === f;
              const hlTo = toCoords && toCoords.r === r && toCoords.f === f;
              const squareKey = `${r},${f}`;
              const hideDestinationPiece = hiddenSquares.has(squareKey);
              const squareAnims = moveAnimsByFrom.get(squareKey) ?? [];
              return (
                <div
                  class={[
                    "board-sq",
                    isLight ? "board-sq--light" : "board-sq--dark",
                    hlFrom ? "board-sq--highlight-from" : "",
                    hlTo ? "board-sq--highlight-to" : "",
                  ].filter(Boolean).join(" ")}
                  key={f}
                >
                  {piece && !hideDestinationPiece ? (
                    <span class={`board-piece ${WHITE_PIECES.has(piece) ? "board-piece--white" : "board-piece--black"}`}>
                      {PIECE_UNICODE[piece]}
                    </span>
                  ) : null}
                  {squareAnims.map((anim) => {
                    const fromDisplayR = flipped ? 7 - anim.from.r : anim.from.r;
                    const fromDisplayF = flipped ? 7 - anim.from.f : anim.from.f;
                    const toDisplayR = flipped ? 7 - anim.to.r : anim.to.r;
                    const toDisplayF = flipped ? 7 - anim.to.f : anim.to.f;
                    const dx = (toDisplayF - fromDisplayF) * SQUARE_SIZE;
                    const dy = (toDisplayR - fromDisplayR) * SQUARE_SIZE;
                    return (
                      <span
                        key={anim.id}
                        class={`board-piece board-piece--moving ${WHITE_PIECES.has(anim.piece) ? "board-piece--white" : "board-piece--black"}`}
                        style={{
                          "--move-dx": `${dx}px`,
                          "--move-dy": `${dy}px`,
                          "--move-ms": `${MOVE_PREVIEW_ANIM_MS}ms`,
                        }}
                      >
                        {PIECE_UNICODE[anim.piece]}
                      </span>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
        <div class="board-file-labels">
          <span class="board-rank-label" />
          {fileLabels.map((f) => (
            <span class="board-file-label" key={f}>{f}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
