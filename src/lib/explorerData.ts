import BitboardChess from "bitboard-chess";

import { sanForEngine } from "./gameMoves";
import { getMovesForPosition, type MoveRecord } from "./gamesDb";

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

export type ColorFilter = "both" | "w" | "b";

export type AggregatedMove = {
  san: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  fenHashAfter: string;
};

function classifyResult(result: string | undefined, userColor: "w" | "b" | undefined): "win" | "draw" | "loss" | null {
  if (!result || !userColor) return null;
  if (result === "1/2-1/2") return "draw";
  if (result === "1-0") return userColor === "w" ? "win" : "loss";
  if (result === "0-1") return userColor === "b" ? "win" : "loss";
  return null;
}

export function aggregateMoves(records: MoveRecord[], colorFilter: ColorFilter = "both"): AggregatedMove[] {
  const map = new Map<string, { games: number; wins: number; draws: number; losses: number; fenHashAfter: string }>();

  for (const r of records) {
    if (colorFilter !== "both" && r.userColor !== colorFilter) continue;

    const entry = map.get(r.san);
    const outcome = classifyResult(r.result, r.userColor);
    const w = outcome === "win" ? 1 : 0;
    const d = outcome === "draw" ? 1 : 0;
    const l = outcome === "loss" ? 1 : 0;

    if (entry) {
      entry.games++;
      entry.wins += w;
      entry.draws += d;
      entry.losses += l;
    } else {
      map.set(r.san, { games: 1, wins: w, draws: d, losses: l, fenHashAfter: r.fenHashAfter });
    }
  }

  return Array.from(map.entries())
    .map(([san, v]) => ({ san, ...v }))
    .sort((a, b) => b.games - a.games);
}

export async function fetchAggregatedMoves(posHash: string, colorFilter: ColorFilter = "both"): Promise<AggregatedMove[]> {
  const records = await getMovesForPosition(posHash);
  return aggregateMoves(records, colorFilter);
}
