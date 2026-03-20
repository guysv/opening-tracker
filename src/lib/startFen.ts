import pgnParser from "pgn-parser";

/** Piece placement for normal chess start (matches standard FEN token 0). */
export const STANDARD_START_PLACEMENT =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";

function headerMapFromPgn(pgn: string): Map<string, string> | null {
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

    return values;
  } catch {
    return null;
  }
}

/**
 * Start FEN for replay from move 1:
 * 1. PGN `[SetUp "1"]` + `[FEN "…"]`
 * 2. Chess.com `initial_setup`. Do **not** use API top-level `fen` (final position).
 * 3. `null` → caller uses default `new BitboardChess()`.
 */
export function resolveStartFen(pgn: string | null, initialSetup: string | null): string | null {
  if (pgn) {
    const headers = headerMapFromPgn(pgn);
    if (headers) {
      const setup = headers.get("setup");
      const fenHeader = headers.get("fen");
      if (setup === "1" && fenHeader) {
        return fenHeader;
      }
    }
  }
  if (initialSetup) {
    return initialSetup;
  }
  return null;
}

function castlingTokenIsStandard(token: string | undefined): boolean {
  if (token === undefined || token === "" || token === "-") {
    return true;
  }
  for (const ch of token) {
    if (ch !== "K" && ch !== "Q" && ch !== "k" && ch !== "q") {
      return false;
    }
  }
  return true;
}

/**
 * Keep only games that start from the normal chess position with a parseable, standard FEN.
 * Drops Chess960, from-position, malformed FEN, and castling fields `bitboard-chess` cannot hash.
 */
export function isStandardImportStart(pgn: string | null, initialSetup: string | null): boolean {
  const fen = resolveStartFen(pgn, initialSetup);
  if (fen == null) {
    return true;
  }

  const tokens = fen.trim().split(/\s+/);
  if (tokens.length < 3) {
    return false;
  }

  const [placement, side, castling] = tokens;
  if (placement !== STANDARD_START_PLACEMENT) {
    return false;
  }
  if (side !== "w" && side !== "b") {
    return false;
  }
  if (!castlingTokenIsStandard(castling)) {
    return false;
  }

  return true;
}
