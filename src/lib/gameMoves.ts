import BitboardChess from "bitboard-chess";
import pgnParser from "pgn-parser";

import type { GameRecord, MoveRecord } from "./gamesDb";
import { resolveStartFen } from "./startFen";

/** Digits for `id` suffix so `IDBKeyRange` per game works (see plan). */
const MOVE_INDEX_PAD = 5;

const NAG_SUFFIXES = ["!!", "??", "!?", "?!", "!", "?"] as const;

function zobristKeyToHex(key: bigint): string {
  return key.toString(16).padStart(16, "0");
}

/** Strip PGN annotations so `bitboard-chess` can parse the SAN. Raw SAN stays in stored rows. */
export function sanForEngine(raw: string): string {
  let s = raw.trim();
  for (const n of NAG_SUFFIXES) {
    if (s.endsWith(n)) {
      s = s.slice(0, -n.length).trimEnd();
      break;
    }
  }
  if (s.endsWith("+") || s.endsWith("#")) {
    s = s.slice(0, -1).trimEnd();
  }
  return s.trim();
}

export { resolveStartFen } from "./startFen";

export function extractMainLineSans(pgn: string | null): string[] {
  if (!pgn) {
    return [];
  }

  try {
    const parsed = pgnParser.parse(pgn);
    const firstGame = Array.isArray(parsed) ? parsed[0] : null;
    const moves = firstGame?.moves ?? [];
    const sans: string[] = [];

    for (const node of moves) {
      const m = node.move;
      if (typeof m === "string" && m.length > 0) {
        sans.push(m);
      }
    }

    return sans;
  } catch {
    return [];
  }
}

export function buildMoveRecords(record: GameRecord): MoveRecord[] {
  const gameId = record.uuid;
  const pgn = record.pgn;
  const sans = extractMainLineSans(pgn);

  if (sans.length === 0) {
    return [];
  }

  const board = new BitboardChess();
  const startFen = resolveStartFen(pgn, record.initialSetup);

  if (startFen) {
    board.loadFromFEN(startFen);
  }

  const out: MoveRecord[] = [];

  for (let i = 0; i < sans.length; i++) {
    const san = sans[i]!;
    const fenHashBefore = zobristKeyToHex(board.getZobristKey());
    const engineSan = sanForEngine(san);
    const ok = board.makeMoveSAN(engineSan);

    if (!ok) {
      break;
    }

    const fenHashAfter = zobristKeyToHex(board.getZobristKey());
    const id = `${gameId}:${String(i).padStart(MOVE_INDEX_PAD, "0")}`;

    out.push({
      id,
      gameId,
      fenHashBefore,
      san,
      fenHashAfter,
    });
  }

  return out;
}
