import BitboardChess from "bitboard-chess";

import { sanForEngine } from "./gameMoves";
import { getGamesByUuids, getMovesForPosition, type MoveRecord } from "./gamesDb";
import { inferUserColor } from "./gameMoves";

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

async function withInferredUserColor(records: MoveRecord[]): Promise<MoveRecord[]> {
  const needGameIds = [...new Set(records.filter((r) => r.userColor === undefined).map((r) => r.gameId))];
  if (needGameIds.length === 0) {
    return records;
  }

  const games = await getGamesByUuids(needGameIds);

  return records.map((r) => {
    if (r.userColor !== undefined) return r;
    const g = games.get(r.gameId);
    if (!g) return r;
    const userColor = inferUserColor(g);
    return userColor ? { ...r, userColor } : r;
  });
}

export async function fetchAggregatedMoves(posHash: string, colorFilter: ColorFilter = "w"): Promise<AggregatedMove[]> {
  const records = await getMovesForPosition(posHash);
  const enriched = await withInferredUserColor(records);
  return aggregateMoves(enriched, colorFilter);
}
