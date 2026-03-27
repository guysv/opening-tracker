import BitboardChess from "bitboard-chess";
import pgnParser from "pgn-parser";

import { sanForEngine } from "./gameMoves";
import { getPositionData } from "./dbClient";
import type { GameRecord, MoveRecord } from "./gamesDb";

export type EloRange = [number, number];

/** Inclusive game `endTime` window in **Unix seconds** (matches `GameRecord.endTime`). */
export type DateRangeSec = [number, number];

/** Align DB min/max `endTime` to UTC calendar-day bounds for the slider. */
export function toDayAlignedDateRange(minSec: number, maxSec: number): DateRangeSec {
  const lo = Math.floor(minSec / 86400) * 86400;
  const hi = Math.floor(maxSec / 86400) * 86400 + 86399;
  return [lo, hi];
}

/** No date filter when the selection matches the full DB-derived span. */
export function effectiveDateFilter(
  selected: DateRangeSec | null,
  bounds: DateRangeSec | null,
): DateRangeSec | null {
  if (!selected || !bounds) return null;
  if (selected[0] === bounds[0] && selected[1] === bounds[1]) return null;
  return selected;
}

export function clampDateRangeToBounds(selected: DateRangeSec, bounds: DateRangeSec): DateRangeSec {
  const [bLo, bHi] = bounds;
  let lo = Math.max(bLo, Math.min(selected[0], bHi));
  let hi = Math.max(bLo, Math.min(selected[1], bHi));
  if (lo > hi) return [bHi, bHi];
  return [lo, hi];
}

function zobristKeyToHex(key: bigint): string {
  return key.toString(16).padStart(16, "0");
}

export type ReplayResult = {
  fen: string;
  posHash: string;
  sideToMove: "w" | "b";
  /** null when all SANs replayed successfully; otherwise the failing SAN. */
  error: string | null;
  /** How many plies were actually applied (may be < sans.length on error). */
  pliesApplied: number;
};

export function replayMoves(sans: string[]): ReplayResult {
  const board = new BitboardChess();

  for (let i = 0; i < sans.length; i++) {
    const ok = board.makeMoveSAN(sanForEngine(sans[i]!));
    if (!ok) {
      return {
        fen: board.toFEN(),
        posHash: zobristKeyToHex(board.getZobristKey()),
        sideToMove: board.toFEN().split(" ")[1] === "b" ? "b" : "w",
        error: sans[i]!,
        pliesApplied: i,
      };
    }
  }

  const fen = board.toFEN();
  return {
    fen,
    posHash: zobristKeyToHex(board.getZobristKey()),
    sideToMove: fen.split(" ")[1] === "b" ? "b" : "w",
    error: null,
    pliesApplied: sans.length,
  };
}

export function startPositionHash(): string {
  const board = new BitboardChess();
  return zobristKeyToHex(board.getZobristKey());
}

export type HoverMovePreview = {
  fen: string;
  fromSq: string;
  toSq: string;
};

function sqIndexToAlgebraic(i: number): string {
  const file = String.fromCharCode(97 + (i % 8));
  const rank = Math.floor(i / 8) + 1;
  return `${file}${rank}`;
}

/** Board after playing `san` from the position reached by `via`, plus from/to for square highlights. */
export function previewHoveredMove(via: string[], san: string): HoverMovePreview | null {
  const board = new BitboardChess();
  for (const s of via) {
    if (!board.makeMoveSAN(sanForEngine(s))) return null;
  }
  const cleaned = sanForEngine(san);
  const move = board.resolveSAN(cleaned);
  if (!move) return null;
  const fromSq = sqIndexToAlgebraic(move.from);
  const toSq = sqIndexToAlgebraic(move.to);
  if (!board.makeMoveSAN(cleaned)) return null;
  return { fen: board.toFEN(), fromSq, toSq };
}

export type ColorFilter = "w" | "b";

export type AggregatedMove = {
  san: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  trapWins: number;
  mateWins: number;
  fenHashAfter: string;
};

function classifyResult(result: string | undefined, userColor: "w" | "b" | undefined): "win" | "draw" | "loss" | null {
  if (!result || !userColor) return null;
  if (result === "1/2-1/2") return "draw";
  if (result === "1-0") return userColor === "w" ? "win" : "loss";
  if (result === "0-1") return userColor === "b" ? "win" : "loss";
  return null;
}

export function aggregateMoves(records: MoveRecord[], colorFilter: ColorFilter = "w"): AggregatedMove[] {
  const map = new Map<string, { games: number; wins: number; draws: number; losses: number; trapWins: number; mateWins: number; fenHashAfter: string }>();

  for (const r of records) {
    if (r.userColor !== colorFilter) continue;

    const entry = map.get(r.san);
    const outcome = classifyResult(r.result, r.userColor);
    const w = outcome === "win" ? 1 : 0;
    const d = outcome === "draw" ? 1 : 0;
    const l = outcome === "loss" ? 1 : 0;
    const tw = (w && r.winKind === "trap") ? 1 : 0;
    const mw = (w && r.winKind === "mate") ? 1 : 0;

    if (entry) {
      entry.games++;
      entry.wins += w;
      entry.draws += d;
      entry.losses += l;
      entry.trapWins += tw;
      entry.mateWins += mw;
    } else {
      map.set(r.san, { games: 1, wins: w, draws: d, losses: l, trapWins: tw, mateWins: mw, fenHashAfter: r.fenHashAfter });
    }
  }

  return Array.from(map.entries())
    .map(([san, v]) => ({ san, ...v }))
    .sort((a, b) => b.games - a.games);
}

/** Sum per-move aggregates; each game is counted once across moves from this position. */
export function positionTotalsFromMoves(moves: AggregatedMove[]): AggregatedMove {
  const acc = {
    san: "",
    games: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    trapWins: 0,
    mateWins: 0,
    fenHashAfter: "",
  };
  for (const m of moves) {
    acc.games += m.games;
    acc.wins += m.wins;
    acc.draws += m.draws;
    acc.losses += m.losses;
    acc.trapWins += m.trapWins;
    acc.mateWins += m.mateWins;
  }
  return acc;
}

function extractEloFromPgn(pgn: string | null): { whiteElo: number | null; blackElo: number | null } {
  if (!pgn) return { whiteElo: null, blackElo: null };
  try {
    const parsed = pgnParser.parse(pgn);
    const firstGame = Array.isArray(parsed) ? parsed[0] : null;
    const headers = firstGame && Array.isArray(firstGame.headers) ? firstGame.headers : [];
    let whiteElo: number | null = null;
    let blackElo: number | null = null;
    for (const h of headers) {
      if (!h || typeof h.name !== "string" || typeof h.value !== "string") continue;
      const name = h.name.toLowerCase();
      if (name === "whiteelo") { const n = Number(h.value); if (Number.isFinite(n)) whiteElo = n; }
      else if (name === "blackelo") { const n = Number(h.value); if (Number.isFinite(n)) blackElo = n; }
    }
    return { whiteElo, blackElo };
  } catch { return { whiteElo: null, blackElo: null }; }
}

const pgnEloCache = new Map<string, { whiteElo: number | null; blackElo: number | null }>();

function getGameRatings(g: GameRecord): { whiteRating: number | null; blackRating: number | null } {
  if (g.whiteRating != null || g.blackRating != null) {
    return { whiteRating: g.whiteRating, blackRating: g.blackRating };
  }
  const cacheKey = `${g.source}:${g.externalId}`;
  let cached = pgnEloCache.get(cacheKey);
  if (!cached) {
    cached = extractEloFromPgn(g.pgn);
    pgnEloCache.set(cacheKey, cached);
  }
  return { whiteRating: cached.whiteElo, blackRating: cached.blackElo };
}

function opponentRating(r: MoveRecord, g: GameRecord): number | null {
  const ratings = getGameRatings(g);
  const rating = r.userColor === "w" ? ratings.blackRating : ratings.whiteRating;
  return rating ?? null;
}

export type PositionData = {
  records: MoveRecord[];
  games: Map<number, GameRecord>;
};

export async function fetchPositionData(
  posHash: string,
  includeUsernames?: string[],
): Promise<PositionData> {
  const payload = await getPositionData(posHash, includeUsernames);
  const records = payload.records;
  const games = new Map<number, GameRecord>();
  for (const g of payload.games) {
    if (Number.isFinite(g.gameKey)) games.set(g.gameKey, g);
  }

  // Warm PGN elo cache eagerly so subsequent filterPositionData calls are instant
  for (const g of games.values()) getGameRatings(g);

  return { records, games };
}

export function filterPositionData(
  data: PositionData,
  colorFilter: ColorFilter,
  eloRange: EloRange | null,
  dateRangeSec: DateRangeSec | null = null,
): AggregatedMove[] {
  let filtered = data.records;

  if (eloRange) {
    const [minElo, maxElo] = eloRange;
    filtered = filtered.filter((r) => {
      const g = data.games.get(r.gameId);
      if (!g) return true;
      const rating = opponentRating(r, g);
      if (rating == null) return true;
      return rating >= minElo && rating <= maxElo;
    });
  }

  if (dateRangeSec) {
    const [minT, maxT] = dateRangeSec;
    filtered = filtered.filter((r) => {
      const g = data.games.get(r.gameId);
      if (!g) return true;
      const t = g.endTime;
      if (t == null) return true;
      return t >= minT && t <= maxT;
    });
  }

  return aggregateMoves(filtered, colorFilter);
}

export type MoveGameListItem = {
  gameId: number;
  /** Half-move index in the main line (matches `moves.ply` in the DB). */
  ply: number;
  url: string;
  whiteUsername: string;
  blackUsername: string;
  whiteRating: number | null;
  blackRating: number | null;
  outcome: "win" | "draw" | "loss" | null;
  endTime: number | null;
};

/** Games that contributed to the aggregated row for `san`, using the same color and Elo filters as the table. */
export function listGamesForMove(
  data: PositionData,
  san: string,
  colorFilter: ColorFilter,
  eloRange: EloRange | null,
  dateRangeSec: DateRangeSec | null = null,
): MoveGameListItem[] {
  let filtered = data.records.filter((r) => r.san === san && r.userColor === colorFilter);
  if (eloRange) {
    const [minElo, maxElo] = eloRange;
    filtered = filtered.filter((r) => {
      const g = data.games.get(r.gameId);
      if (!g) return true;
      const rating = opponentRating(r, g);
      if (rating == null) return true;
      return rating >= minElo && rating <= maxElo;
    });
  }

  if (dateRangeSec) {
    const [minT, maxT] = dateRangeSec;
    filtered = filtered.filter((r) => {
      const g = data.games.get(r.gameId);
      if (!g) return true;
      const t = g.endTime;
      if (t == null) return true;
      return t >= minT && t <= maxT;
    });
  }

  const rows: MoveGameListItem[] = filtered.map((r) => {
    const g = data.games.get(r.gameId);
    const ratings = g ? getGameRatings(g) : { whiteRating: null as number | null, blackRating: null as number | null };
    return {
      gameId: r.gameId,
      ply: r.ply,
      url: g?.url ?? "",
      whiteUsername: g?.whiteUsername ?? "?",
      blackUsername: g?.blackUsername ?? "?",
      whiteRating: ratings.whiteRating,
      blackRating: ratings.blackRating,
      outcome: classifyResult(r.result, r.userColor),
      endTime: g?.endTime ?? null,
    };
  });

  rows.sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0));
  return rows;
}
