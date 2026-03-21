import BitboardChess from "bitboard-chess";
import pgnParser from "pgn-parser";

import type { GameRecord, MoveRecord } from "./gamesDb";
import { resolveStartFen, STANDARD_START_PLACEMENT } from "./startFen";

/** Half-moves (plies) kept per game in IndexedDB (opening slice only). */
export const MAX_STORED_PLIES = 30;

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

/** Resolve which color `username` played using PGN [White]/[Black] when JSON fields are missing or mismatched. */
function userColorFromPgnHeaders(pgn: string | null, username: string): "w" | "b" | undefined {
  if (!pgn || !username) return undefined;
  const u = username.trim().toLowerCase();
  if (!u) return undefined;

  try {
    const parsed = pgnParser.parse(pgn);
    const firstGame = Array.isArray(parsed) ? parsed[0] : null;
    const headers = firstGame && Array.isArray(firstGame.headers) ? firstGame.headers : [];

    let white = "";
    let black = "";
    for (const h of headers) {
      if (!h || typeof h.name !== "string" || typeof h.value !== "string") continue;
      const name = h.name.toLowerCase();
      if (name === "white") white = h.value;
      else if (name === "black") black = h.value;
    }

    if (white.trim().toLowerCase() === u) return "w";
    if (black.trim().toLowerCase() === u) return "b";
  } catch {
    /* ignore */
  }

  return undefined;
}

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

function escapePgnHeaderValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatSansAsMovetext(sans: string[]): string {
  const parts: string[] = [];
  for (let i = 0; i < sans.length; i++) {
    if (i % 2 === 0) {
      parts.push(`${Math.floor(i / 2) + 1}. ${sans[i]}`);
    } else {
      parts.push(sans[i]!);
    }
  }
  return parts.join(" ");
}

/** Headers unchanged; movetext is only the first `maxPlies` half-moves. */
export function truncateGamePgnForStorage(pgn: string | null, maxPlies = MAX_STORED_PLIES): string | null {
  if (!pgn) {
    return null;
  }

  const fullSans = extractMainLineSans(pgn);
  const sans = fullSans.slice(0, maxPlies);

  if (sans.length === 0 || sans.length === fullSans.length) {
    return pgn;
  }

  try {
    const parsed = pgnParser.parse(pgn);
    const firstGame = Array.isArray(parsed) ? parsed[0] : null;
    const headers = firstGame?.headers ?? [];
    const lines: string[] = [];
    let resultToken = "*";

    for (const h of headers) {
      if (typeof h?.name === "string" && typeof h?.value === "string") {
        if (h.name.toLowerCase() === "result") {
          const v = h.value.trim();
          resultToken = v.length > 0 ? v : "*";
        }
        lines.push(`[${h.name} "${escapePgnHeaderValue(h.value)}"]`);
      }
    }

    const movetext = formatSansAsMovetext(sans);
    // pgn-parser requires a game-termination token after movetext (e.g. 1-0, *). Rebuilt movetext
    // previously ended mid-line and failed to parse, yielding zero SANs for most stored games.
    const body = `${movetext} ${resultToken}`;
    return lines.length > 0 ? `${lines.join("\n")}\n\n${body}` : body;
  } catch {
    return pgn;
  }
}

export function truncateGameRecordForStorage(record: GameRecord): GameRecord {
  return { ...record, pgn: truncateGamePgnForStorage(record.pgn) };
}

export function inferUserColor(
  record: Pick<GameRecord, "username" | "whiteUsername" | "blackUsername" | "pgn">,
): "w" | "b" | undefined {
  const u = record.username?.trim();
  if (!u) return undefined;
  if (record.whiteUsername.trim().toLowerCase() === u.toLowerCase()) return "w";
  if (record.blackUsername.trim().toLowerCase() === u.toLowerCase()) return "b";
  return userColorFromPgnHeaders(record.pgn, u);
}

function popcount64(n: bigint): number {
  let count = 0;
  let v = n;
  while (v !== 0n) {
    v &= v - 1n;
    count++;
  }
  return count;
}

/** White − Black material in pawn-units (P=1, N=B=3, R=5, Q=9). */
function materialBalance(board: BitboardChess): number {
  const p = board.getPosition();
  const w =
    popcount64(p.whitePawns) +
    popcount64(p.whiteKnights) * 3 +
    popcount64(p.whiteBishops) * 3 +
    popcount64(p.whiteRooks) * 5 +
    popcount64(p.whiteQueens) * 9;
  const b =
    popcount64(p.blackPawns) +
    popcount64(p.blackKnights) * 3 +
    popcount64(p.blackBishops) * 3 +
    popcount64(p.blackRooks) * 5 +
    popcount64(p.blackQueens) * 9;
  return w - b;
}

function isUserWin(result: string | undefined, userColor: "w" | "b" | undefined): boolean {
  if (!result || !userColor) return false;
  if (result === "1-0") return userColor === "w";
  if (result === "0-1") return userColor === "b";
  return false;
}

export function buildMoveRecords(record: GameRecord): MoveRecord[] {
  const gameId = record.uuid;
  const pgn = record.pgn;
  const sans = extractMainLineSans(pgn).slice(0, MAX_STORED_PLIES);

  if (sans.length === 0) {
    return [];
  }

  const board = new BitboardChess();
  const startFen = resolveStartFen(pgn, record.initialSetup);

  if (startFen) {
    const tokens = startFen.trim().split(/\s+/);
    const placement = tokens[0];
    const side = tokens[1];
    // Standard placement + w: ignore FEN castling/ep quirks so Zobrist matches `startPositionHash()`.
    const useEngineDefaultStart =
      placement === STANDARD_START_PLACEMENT && side === "w";
    if (!useEngineDefaultStart) {
      board.loadFromFEN(startFen);
    }
  }

  const result = record.result ?? undefined;
  const userColor = inferUserColor(record);

  const out: MoveRecord[] = [];
  let maxUserAdvantage = 0;
  let earlyMateByUser = false;

  for (let i = 0; i < sans.length; i++) {
    const san = sans[i]!;
    const fenHashBefore = zobristKeyToHex(board.getZobristKey());
    const engineSan = sanForEngine(san);
    const ok = board.makeMoveSAN(engineSan);

    if (!ok) {
      break;
    }

    if (userColor) {
      const bal = materialBalance(board);
      const adv = userColor === "w" ? bal : -bal;
      if (adv > maxUserAdvantage) maxUserAdvantage = adv;

      const userMoved = (i % 2 === 0) === (userColor === "w");
      if (userMoved && san.includes("#")) earlyMateByUser = true;
    }

    const fenHashAfter = zobristKeyToHex(board.getZobristKey());
    const id = `${gameId}:${String(i).padStart(MOVE_INDEX_PAD, "0")}`;

    out.push({
      id,
      gameId,
      fenHashBefore,
      san,
      fenHashAfter,
      result,
      userColor,
    });
  }

  if (isUserWin(result, userColor)) {
    const kind: "mate" | "trap" | undefined = earlyMateByUser
      ? "mate"
      : maxUserAdvantage >= 3
        ? "trap"
        : undefined;
    if (kind) {
      for (const m of out) m.winKind = kind;
    }
  }

  return out;
}
