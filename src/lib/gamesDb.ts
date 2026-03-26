import pgnParser from "pgn-parser";

import { isStandardImportStart } from "./startFen";

export type MoveRecord = {
  gameId: number;
  ply: number;
  /** 64-bit Zobrist key from `bitboard-chess` `getZobristKey()`, hex string (16 chars). */
  fenHashBefore: string;
  san: string;
  fenHashAfter: string;
  /** PGN Result header: "1-0", "0-1", "1/2-1/2", or "*". Filled by `GET_MOVES_FOR_POSITION` query. */
  result?: string;
  /** Perspective color for aggregation: "w" or "b". Filled by `GET_MOVES_FOR_POSITION` query. */
  userColor?: "w" | "b";
  /** How the relevant side won within the opening window: "trap" (material >= +3), "mate" (early checkmate). */
  winKind?: "trap" | "mate";
};

export type GameRecord = {
  gameKey: number;
  source: string;
  externalId: string;
  url: string;
  whiteUsername: string;
  blackUsername: string;
  whiteRating: number | null;
  blackRating: number | null;
  endTime: number | null;
  /** Starting position from the API (`initial_setup`). Use this (or default) when replaying the PGN from move 1. */
  initialSetup: string | null;
  pgn: string | null;
  /** PGN Result header: "1-0", "0-1", "1/2-1/2", or "*". */
  result: string | null;
  /** Outcome label when the game is won by White. */
  whiteWinKind: "trap" | "mate" | null;
  /** Outcome label when the game is won by Black. */
  blackWinKind: "trap" | "mate" | null;
  importedAt: number;
};

export type ChessArchiveGame = {
  uuid?: unknown;
  url?: unknown;
  pgn?: unknown;
  end_time?: unknown;
  time_class?: unknown;
  rated?: unknown;
  eco?: unknown;
  fen?: unknown;
  initial_setup?: unknown;
  rules?: unknown;
  time_control?: unknown;
  white?: {
    username?: unknown;
    rating?: unknown;
  };
  black?: {
    username?: unknown;
    rating?: unknown;
  };
};

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/** Result of a single `pgn-parser` pass on the archive PGN (import hot path). */
export type ParseChessComPgnResult = {
  headerMap: Map<string, string>;
  headers: Array<{ name: string; value: string }>;
  mainLineSans: string[];
};

/** One parse for headers + main-line SANs; used to avoid 3–4 parses per game during import. */
export function parseChessComPgnOnce(pgn: string): ParseChessComPgnResult | null {
  try {
    const parsed = pgnParser.parse(pgn);
    const firstGame = Array.isArray(parsed) ? parsed[0] : null;
    if (!firstGame) {
      return null;
    }

    const rawHeaders = Array.isArray(firstGame.headers) ? firstGame.headers : [];
    const headerMap = new Map<string, string>();
    const headers: Array<{ name: string; value: string }> = [];

    for (const header of rawHeaders) {
      if (!header || typeof header.name !== "string" || typeof header.value !== "string") {
        continue;
      }
      headerMap.set(header.name.toLowerCase(), header.value);
      headers.push({ name: header.name, value: header.value });
    }

    const mainLineSans: string[] = [];
    for (const node of firstGame.moves ?? []) {
      const m = node.move;
      if (typeof m === "string" && m.length > 0) {
        mainLineSans.push(m);
      }
    }

    return { headerMap, headers, mainLineSans };
  } catch {
    return null;
  }
}

function parsePgnHeaders(pgn: string | null): {
  result: string | null;
} {
  if (!pgn) {
    return { result: null };
  }

  try {
    const parsed = pgnParser.parse(pgn);
    const firstGame = Array.isArray(parsed) ? parsed[0] : null;
    const headers = firstGame && Array.isArray(firstGame.headers) ? firstGame.headers : [];
    const values = new Map<string, string>();

    for (const header of headers) {
      if (!header || typeof header.name !== "string" || typeof header.value !== "string") {
        continue;
      }
      values.set(header.name.toLowerCase(), header.value);
    }

    return {
      result: values.get("result") ?? null,
    };
  } catch {
    return { result: null };
  }
}

export function toGameRecord(
  game: ChessArchiveGame,
  /** When provided, skips redundant `pgn-parser` work (import worker). */
  parsedOnce?: ParseChessComPgnResult | null,
): GameRecord | null {
  const url = asString(game.url);
  const externalId = gameIdFromUrl(url);

  if (!externalId || !url) {
    return null;
  }

  const pgn = asString(game.pgn);
  const initialSetup = asString(game.initial_setup);

  if (parsedOnce) {
    if (!isStandardImportStart(pgn, initialSetup, parsedOnce.headerMap)) {
      return null;
    }
  } else if (!isStandardImportStart(pgn, initialSetup)) {
    return null;
  }

  const pgnHeaders = parsedOnce
    ? {
        result: parsedOnce.headerMap.get("result") ?? null,
      }
    : parsePgnHeaders(pgn);

  return {
    gameKey: 0,
    source: "chesscom",
    externalId,
    url,
    whiteUsername: (asString(game.white?.username) ?? "").trim().toLowerCase(),
    blackUsername: (asString(game.black?.username) ?? "").trim().toLowerCase(),
    whiteRating: asNumber(game.white?.rating),
    blackRating: asNumber(game.black?.rating),
    endTime: asNumber(game.end_time),
    initialSetup,
    pgn,
    result: pgnHeaders.result,
    whiteWinKind: null,
    blackWinKind: null,
    importedAt: Date.now(),
  };
}

function gameIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.trim().toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, "");
    if (!host || !path) return null;
    if (host.endsWith("chess.com")) {
      const parts = path.split("/").filter(Boolean);
      if (parts.length >= 3 && parts[0] === "game" && (parts[1] === "live" || parts[1] === "daily")) {
        const last = parts[parts.length - 1];
        if (last && last !== "live" && last !== "daily") return last;
      }
    }
    return path.split("/").filter(Boolean).pop() ?? null;
  } catch {
    return null;
  }
}
