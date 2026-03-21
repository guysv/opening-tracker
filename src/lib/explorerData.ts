import BitboardChess from "bitboard-chess";
import pgnParser from "pgn-parser";

import { sanForEngine, inferUserColor } from "./gameMoves";
import { getGamesByUuids, getMovesForPosition } from "./dbClient";
import type { GameRecord, MoveRecord } from "./gamesDb";

export type EloRange = [number, number];

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
  let cached = pgnEloCache.get(g.uuid);
  if (!cached) {
    cached = extractEloFromPgn(g.pgn);
    pgnEloCache.set(g.uuid, cached);
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
  games: Map<string, GameRecord>;
};

export async function fetchPositionData(posHash: string): Promise<PositionData> {
  const records = await getMovesForPosition(posHash);
  const gameIds = [...new Set(records.map((r) => r.gameId))];
  const games = gameIds.length > 0 ? await getGamesByUuids(gameIds) : new Map<string, GameRecord>();

  const enriched = records.map((r) => {
    if (r.userColor !== undefined) return r;
    const g = games.get(r.gameId);
    if (!g) return r;
    const userColor = inferUserColor(g);
    return userColor ? { ...r, userColor } : r;
  });

  // Warm PGN elo cache eagerly so subsequent filterPositionData calls are instant
  for (const g of games.values()) getGameRatings(g);

  return { records: enriched, games };
}

export function filterPositionData(
  data: PositionData,
  colorFilter: ColorFilter,
  eloRange: EloRange | null,
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

  return aggregateMoves(filtered, colorFilter);
}
