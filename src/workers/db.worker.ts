import type { Sqlite3Static } from "@sqlite.org/sqlite-wasm";

import type { StockfishEvalRecord } from "../lib/stockfishEval";
import type { GameRecord, MoveRecord } from "../lib/gamesDb";

type ArchiveUpsertRow = {
  username: string;
  path: string;
  fetchedAt: number;
  checkedAt: number;
  gzipJson: Uint8Array;
  /** HTTP `Last-Modified` from the archive response (metadata; browser cannot send `If-Modified-Since` to chess.com). */
  lastModified: string | null;
};

type ArchiveCheckedRow = {
  username: string;
  path: string;
  checkedAt: number;
  lastModified: string | null;
};

type PlayerListRow = {
  username: string;
  gameCount: number;
  minArchivePath: string | null;
  maxArchivePath: string | null;
  lastSyncAt: number | null;
  /** `YYYY/MM` from earliest game `endTime` (UTC), for extend when no archives yet. */
  minGameEndMonth: string | null;
};

type RequestMessage =
  | { type: "UPSERT_GAMES_WITH_MOVES"; id: number; entries: { record: GameRecord; moves: MoveRecord[] }[] }
  | { type: "GET_MOVES_FOR_POSITION"; id: number; fenHash: string; includeUsernames?: string[] }
  | { type: "GET_POSITION_DATA"; id: number; fenHash: string; includeUsernames?: string[] }
  | { type: "GET_GAMES_BY_UUIDS"; id: number; uuids: number[] }
  | { type: "GET_STOCKFISH_EVAL"; id: number; fenHash: string }
  | { type: "UPSERT_STOCKFISH_EVAL"; id: number; row: StockfishEvalRecord }
  | { type: "CLEAR"; id: number }
  | { type: "GET_DB_SIZE"; id: number }
  | { type: "EXPORT_DB"; id: number }
  | { type: "UPSERT_ARCHIVES"; id: number; rows: ArchiveUpsertRow[] }
  | { type: "GET_ARCHIVES_LAST_MODIFIED_FOR_USER"; id: number; username: string }
  | { type: "TOUCH_ARCHIVES_CHECKED"; id: number; rows: ArchiveCheckedRow[] }
  | { type: "LIST_PLAYERS"; id: number }
  | { type: "DELETE_PLAYER"; id: number; username: string }
  | { type: "LIST_BOOKMARKS"; id: number }
  | { type: "ADD_BOOKMARK"; id: number; fragment: string; name: string }
  | { type: "REMOVE_BOOKMARK"; id: number; fragment: string }
  | { type: "SET_BOOKMARK_NAME"; id: number; fragment: string; name: string };

function reply(id: number, result: unknown, error?: string, transfer?: Transferable[]) {
  const msg = error ? { id, error } : { id, result };
  if (transfer?.length) {
    (self as unknown as Worker).postMessage(msg, transfer);
  } else {
    self.postMessage(msg);
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  gameKey INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  externalId TEXT NOT NULL,
  url TEXT NOT NULL,
  whiteUsername TEXT NOT NULL DEFAULT '',
  blackUsername TEXT NOT NULL DEFAULT '',
  whiteRating INTEGER,
  blackRating INTEGER,
  endTime INTEGER,
  initialSetup TEXT,
  pgn TEXT,
  result TEXT,
  whiteWinKind TEXT,
  blackWinKind TEXT,
  importedAt INTEGER NOT NULL,
  UNIQUE (source, externalId)
);
CREATE TABLE IF NOT EXISTS moves (
  gameId INTEGER NOT NULL,
  ply INTEGER NOT NULL,
  fenHashBefore BLOB NOT NULL,
  san TEXT NOT NULL,
  fenHashAfter BLOB NOT NULL,
  PRIMARY KEY (gameId, ply)
);
CREATE INDEX IF NOT EXISTS idx_games_whiteUsername ON games(whiteUsername);
CREATE INDEX IF NOT EXISTS idx_games_blackUsername ON games(blackUsername);
CREATE INDEX IF NOT EXISTS idx_games_endTime ON games(endTime);
CREATE INDEX IF NOT EXISTS idx_moves_fenHashBefore_san ON moves(fenHashBefore, san);
CREATE INDEX IF NOT EXISTS idx_moves_gameId ON moves(gameId);
CREATE TABLE IF NOT EXISTS stockfish_eval (
  fen_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('cp', 'mate')),
  cp INTEGER,
  mate INTEGER,
  depth INTEGER,
  evaluated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS archives (
  username TEXT NOT NULL,
  path TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  checked_at INTEGER,
  gzip_json BLOB NOT NULL,
  last_modified TEXT,
  PRIMARY KEY (username, path)
);
CREATE INDEX IF NOT EXISTS idx_archives_username ON archives(username);
CREATE TABLE IF NOT EXISTS bookmarks (
  fragment TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT ''
);
`;

type Database = InstanceType<Sqlite3Static["oo1"]["DB"]>;
type PositionDataPayload = { records: MoveRecord[]; games: GameRecord[] };

let sqlite3: Sqlite3Static;
let db: Database;
let poolUtil: Awaited<ReturnType<Sqlite3Static["installOpfsSAHPoolVfs"]>> | null = null;

const DB_PATH = "/opening-tracker.db";
const RESET_ON_INIT = new URL(self.location.href).searchParams.get("resetOnInit") === "1";

async function ensureSqliteReady() {
  if (sqlite3 && poolUtil) return;
  const moduleUrl = new URL("/sqlite3/index.mjs", self.location.href).href;
  const { default: sqlite3InitModule } = await import(moduleUrl);
  sqlite3 = await sqlite3InitModule();
  poolUtil = await sqlite3.installOpfsSAHPoolVfs({
    initialCapacity: 6,
    clearOnInit: false,
    name: "opfs-sahpool",
  });
}

function openDb() {
  if (!poolUtil) throw new Error("SQLite OPFS pool not initialized");
  db = new poolUtil.OpfsSAHPoolDb(DB_PATH);
  try {
    db.exec(SCHEMA);
  } catch (e) {
    // If a stale on-disk schema exists (e.g. old `moves.san` vs new `moves.sanId`),
    // hard-rebuild so startup never gets stuck on legacy shape.
    rebuildSchema();
    const message = e instanceof Error ? e.message : String(e);
    console.warn("Schema apply failed; rebuilt schema from scratch:", message);
  }
}

function openDbWithoutSchema() {
  if (!poolUtil) throw new Error("SQLite OPFS pool not initialized");
  db = new poolUtil.OpfsSAHPoolDb(DB_PATH);
}

function rebuildSchema() {
  db.exec(`
DROP INDEX IF EXISTS idx_moves_fenHashBefore;
DROP INDEX IF EXISTS idx_moves_fenHashBefore_san;
DROP INDEX IF EXISTS idx_moves_gameId;
DROP INDEX IF EXISTS idx_games_username;
DROP INDEX IF EXISTS idx_games_whiteUsername;
DROP INDEX IF EXISTS idx_games_blackUsername;
DROP INDEX IF EXISTS idx_games_endTime;
DROP INDEX IF EXISTS idx_archives_username;
DROP TABLE IF EXISTS moves;
DROP TABLE IF EXISTS games;
DROP TABLE IF EXISTS stockfish_eval;
DROP TABLE IF EXISTS archives;
DROP TABLE IF EXISTS bookmarks;
`);
  db.exec(SCHEMA);
}

async function initDb() {
  await ensureSqliteReady();
  if (RESET_ON_INIT) {
    if (!poolUtil) throw new Error("SQLite OPFS pool not initialized");
    try {
      poolUtil.unlink(DB_PATH);
    } catch {
      /* ignore; rebuildSchema() below guarantees fresh shape */
    }
    openDbWithoutSchema();
    rebuildSchema();
    return;
  }
  openDb();
}

function closeDb() {
  try {
    db.close();
  } catch {
    /* best effort close before reset */
  }
}

async function resetDb() {
  if (!poolUtil) throw new Error("SQLite OPFS pool not initialized");
  closeDb();
  // SAH pool VFS tracks virtual files internally. Use its unlink API instead
  // of deleting OPFS root entries directly.
  try {
    poolUtil.unlink(DB_PATH);
  } catch {
    /* fallback below will hard-rebuild schema in-place */
  }
  openDbWithoutSchema();
  rebuildSchema();
}

function upsertGamesWithMoves(entries: { record: GameRecord; moves: MoveRecord[] }[]) {
  db.exec("BEGIN");
  try {
    const delMoves = db.prepare("DELETE FROM moves WHERE gameId = ?");
    const upsertGameSql = `
      INSERT INTO games (source, externalId, url, whiteUsername, blackUsername,
        whiteRating, blackRating, endTime, initialSetup, pgn, result, whiteWinKind, blackWinKind, importedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(source, externalId) DO UPDATE SET
        url=excluded.url,
        whiteUsername=excluded.whiteUsername,
        blackUsername=excluded.blackUsername,
        whiteRating=excluded.whiteRating,
        blackRating=excluded.blackRating,
        endTime=excluded.endTime,
        initialSetup=excluded.initialSetup,
        pgn=excluded.pgn,
        result=excluded.result,
        whiteWinKind=excluded.whiteWinKind,
        blackWinKind=excluded.blackWinKind,
        importedAt=excluded.importedAt
      RETURNING gameKey
    `;
    const insMove = db.prepare(
      `INSERT OR REPLACE INTO moves (gameId, ply, fenHashBefore, san, fenHashAfter)
       VALUES (?,?,?,?,?)`,
    );

    try {
      for (const { record: g, moves } of entries) {
        const keyRows = db.exec(upsertGameSql, {
          bind: [
            g.source, g.externalId, g.url, g.whiteUsername, g.blackUsername,
            g.whiteRating, g.blackRating, g.endTime,
            g.initialSetup, g.pgn, g.result, g.whiteWinKind, g.blackWinKind, g.importedAt,
          ],
          returnValue: "resultRows",
        }) as unknown as number[][];
        const gameKey = Number(keyRows[0]?.[0]);
        if (!Number.isFinite(gameKey)) {
          throw new Error("Failed to resolve gameKey for upserted game");
        }
        delMoves.bind([gameKey]).stepReset();
        for (const m of moves) {
          insMove
            .bind([gameKey, m.ply, hex16ToBytes(m.fenHashBefore), m.san, hex16ToBytes(m.fenHashAfter)])
            .stepReset();
        }
      }
    } finally {
      delMoves.finalize();
      insMove.finalize();
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function getMovesForPosition(fenHash: string, includeUsernames?: string[]): MoveRecord[] {
  const fenHashBytes = hex16ToBytes(fenHash);
  if (includeUsernames !== undefined && includeUsernames.length === 0) {
    return [];
  }
  if (includeUsernames !== undefined && includeUsernames.length > 0) {
    const users = includeUsernames.map((u) => u.trim().toLowerCase());
    const placeholders = users.map(() => "?").join(",");
    const sql = `
      SELECT
        m.gameId, m.ply, lower(hex(m.fenHashBefore)) AS fenHashBefore, m.san, lower(hex(m.fenHashAfter)) AS fenHashAfter,
        g.result AS result,
        'w' AS userColor,
        g.whiteWinKind AS winKind
      FROM moves m
      INNER JOIN games g ON g.gameKey = m.gameId
      WHERE m.fenHashBefore = ?
        AND LOWER(g.whiteUsername) IN (${placeholders})
      UNION ALL
      SELECT
        m.gameId, m.ply, lower(hex(m.fenHashBefore)) AS fenHashBefore, m.san, lower(hex(m.fenHashAfter)) AS fenHashAfter,
        g.result AS result,
        'b' AS userColor,
        g.blackWinKind AS winKind
      FROM moves m
      INNER JOIN games g ON g.gameKey = m.gameId
      WHERE m.fenHashBefore = ?
        AND LOWER(g.blackUsername) IN (${placeholders})
    `;
    return db.exec(sql, {
      bind: [fenHashBytes, ...users, fenHashBytes, ...users],
      rowMode: "object",
      returnValue: "resultRows",
    }) as unknown as MoveRecord[];
  }
  // No username filter: treat both sides as potentially "owned" by tracked players.
  return db.exec(
    `
      SELECT
        m.gameId, m.ply, lower(hex(m.fenHashBefore)) AS fenHashBefore, m.san, lower(hex(m.fenHashAfter)) AS fenHashAfter,
        g.result AS result,
        'w' AS userColor,
        g.whiteWinKind AS winKind
      FROM moves m
      INNER JOIN games g ON g.gameKey = m.gameId
      WHERE m.fenHashBefore = ?
      UNION ALL
      SELECT
        m.gameId, m.ply, lower(hex(m.fenHashBefore)) AS fenHashBefore, m.san, lower(hex(m.fenHashAfter)) AS fenHashAfter,
        g.result AS result,
        'b' AS userColor,
        g.blackWinKind AS winKind
      FROM moves m
      INNER JOIN games g ON g.gameKey = m.gameId
      WHERE m.fenHashBefore = ?
    `,
    {
      bind: [fenHashBytes, fenHashBytes],
      rowMode: "object",
      returnValue: "resultRows",
    },
  ) as unknown as MoveRecord[];
}

function hex16ToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(clean)) {
    throw new Error(`Invalid 64-bit hex key: ${hex}`);
  }
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    const byteHex = clean.slice(i * 2, i * 2 + 2);
    out[i] = Number.parseInt(byteHex, 16);
  }
  return out;
}


function getGamesByUuids(uuids: number[]): GameRecord[] {
  if (uuids.length === 0) return [];
  const placeholders = uuids.map(() => "?").join(",");
  return db.exec(`SELECT * FROM games WHERE gameKey IN (${placeholders})`, {
    bind: uuids,
    rowMode: "object",
    returnValue: "resultRows",
  }) as unknown as GameRecord[];
}

function getPositionData(fenHash: string, includeUsernames?: string[]): PositionDataPayload {
  const records = getMovesForPosition(fenHash, includeUsernames);
  const gamesById = new Map<number, GameRecord>();
  const gameRows = db.exec(
    `
      SELECT DISTINCT
        g.gameKey, g.source, g.externalId, g.url, g.whiteUsername, g.blackUsername,
        g.whiteRating, g.blackRating, g.endTime, g.initialSetup, g.pgn, g.result,
        g.whiteWinKind, g.blackWinKind, g.importedAt
      FROM moves m
      INNER JOIN games g ON g.gameKey = m.gameId
      WHERE m.fenHashBefore = ?
    `,
    {
      bind: [hex16ToBytes(fenHash)],
      rowMode: "object",
      returnValue: "resultRows",
    },
  ) as unknown as GameRecord[];
  for (const g of gameRows) {
    gamesById.set(g.gameKey, g);
  }
  return { records, games: [...gamesById.values()] };
}

function getStockfishEval(fenHash: string): StockfishEvalRecord | null {
  const rows = db.exec("SELECT * FROM stockfish_eval WHERE fen_hash = ?", {
    bind: [fenHash],
    rowMode: "object",
    returnValue: "resultRows",
  }) as unknown as StockfishEvalRecord[];
  return rows[0] ?? null;
}

function upsertStockfishEval(row: StockfishEvalRecord) {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO stockfish_eval (fen_hash, kind, cp, mate, depth, evaluated_at)
     VALUES (?,?,?,?,?,?)`,
  );
  try {
    stmt
      .bind([
        row.fen_hash,
        row.kind,
        row.cp,
        row.mate,
        row.depth,
        row.evaluated_at,
      ])
      .stepReset();
  } finally {
    stmt.finalize();
  }
}

function upsertArchives(rows: ArchiveUpsertRow[]) {
  if (rows.length === 0) return;
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO archives (username, path, fetched_at, checked_at, gzip_json, last_modified) VALUES (?,?,?,?,?,?)`,
  );
  try {
    for (const r of rows) {
      stmt
        .bind(1, r.username)
        .bind(2, r.path)
        .bind(3, r.fetchedAt)
        .bind(4, r.checkedAt)
        .bindAsBlob(5, r.gzipJson)
        .bind(6, r.lastModified ?? null)
        .stepReset();
    }
  } finally {
    stmt.finalize();
  }
}

/** `path` → stored HTTP `Last-Modified` (or null). Used to skip GET after a matching HEAD. */
function getArchivesLastModifiedForUser(username: string): Record<string, string | null> {
  const u = username.trim().toLowerCase();
  const out: Record<string, string | null> = {};
  if (!u) return out;
  const raw = db.exec("SELECT path, last_modified FROM archives WHERE username = ?", {
    bind: [u],
    rowMode: "object",
    returnValue: "resultRows",
  }) as unknown as Record<string, unknown>[];
  for (const row of raw) {
    const path = String(row.path);
    out[path] =
      row.last_modified != null && String(row.last_modified).length > 0
        ? String(row.last_modified)
        : null;
  }
  return out;
}

function touchArchivesChecked(rows: ArchiveCheckedRow[]) {
  if (rows.length === 0) return;
  const stmt = db.prepare(
    `UPDATE archives
     SET checked_at = ?,
         last_modified = COALESCE(?, last_modified)
     WHERE username = ? AND path = ?`,
  );
  try {
    for (const r of rows) {
      const u = r.username.trim().toLowerCase();
      if (!u || !r.path || !Number.isFinite(r.checkedAt)) continue;
      stmt
        .bind(1, Math.floor(r.checkedAt))
        .bind(2, r.lastModified ?? null)
        .bind(3, u)
        .bind(4, r.path)
        .stepReset();
    }
  } finally {
    stmt.finalize();
  }
}

function listPlayers(): PlayerListRow[] {
  const sql = `
    WITH users AS (SELECT DISTINCT username FROM archives)
    SELECT
      u.username AS username,
      (SELECT COUNT(*) FROM games g WHERE g.whiteUsername = u.username OR g.blackUsername = u.username) AS gameCount,
      (SELECT MIN(a.path) FROM archives a WHERE a.username = u.username) AS minArchivePath,
      (SELECT MAX(a.path) FROM archives a WHERE a.username = u.username) AS maxArchivePath,
      (SELECT MAX(COALESCE(a.checked_at, a.fetched_at)) FROM archives a WHERE a.username = u.username) AS lastSyncAt,
      (SELECT strftime('%Y/%m', datetime(MIN(g.endTime), 'unixepoch')) FROM games g
        WHERE (g.whiteUsername = u.username OR g.blackUsername = u.username) AND g.endTime IS NOT NULL) AS minGameEndMonth
    FROM users u
    ORDER BY u.username COLLATE NOCASE
  `;
  const raw = db.exec(sql, {
    rowMode: "object",
    returnValue: "resultRows",
  }) as unknown as Record<string, unknown>[];
  return raw.map((row) => ({
    username: String(row.username),
    gameCount: Number(row.gameCount) || 0,
    minArchivePath: row.minArchivePath != null ? String(row.minArchivePath) : null,
    maxArchivePath: row.maxArchivePath != null ? String(row.maxArchivePath) : null,
    lastSyncAt: row.lastSyncAt != null ? Number(row.lastSyncAt) : null,
    minGameEndMonth: row.minGameEndMonth != null ? String(row.minGameEndMonth) : null,
  }));
}

function deletePlayer(username: string) {
  const u = username.trim().toLowerCase();
  if (!u) return;
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM moves WHERE gameId IN (SELECT gameKey FROM games WHERE whiteUsername = ? OR blackUsername = ?)", {
      bind: [u, u],
    });
    db.exec("DELETE FROM games WHERE whiteUsername = ? OR blackUsername = ?", {
      bind: [u, u],
    });
    db.exec("DELETE FROM archives WHERE username = ?", { bind: [u] });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

type BookmarkRow = { fragment: string; created_at: number; name: string };

function listBookmarks(): BookmarkRow[] {
  const raw = db.exec(
    "SELECT fragment, created_at, name FROM bookmarks ORDER BY created_at DESC",
    {
      rowMode: "object",
      returnValue: "resultRows",
    },
  ) as unknown as Record<string, unknown>[];
  return raw.map((row) => ({
    fragment: String(row.fragment),
    created_at: Number(row.created_at) || 0,
    name: row.name != null ? String(row.name) : "",
  }));
}

function addBookmark(fragment: string, name: string) {
  const f = fragment.trim();
  if (!f || !f.startsWith("#")) return;
  const n = name.trim();
  const stmt = db.prepare(
    `INSERT INTO bookmarks (fragment, created_at, name) VALUES (?, ?, ?)
     ON CONFLICT(fragment) DO UPDATE SET created_at = excluded.created_at, name = excluded.name`,
  );
  try {
    stmt.bind([f, Math.floor(Date.now() / 1000), n]).stepReset();
  } finally {
    stmt.finalize();
  }
}

function setBookmarkName(fragment: string, name: string) {
  const f = fragment.trim();
  if (!f) return;
  const n = name.trim();
  db.exec("UPDATE bookmarks SET name = ? WHERE fragment = ?", { bind: [n, f] });
}

function removeBookmark(fragment: string) {
  const f = fragment.trim();
  if (!f) return;
  db.exec("DELETE FROM bookmarks WHERE fragment = ?", { bind: [f] });
}

function exportDb(): Uint8Array {
  return sqlite3.capi.sqlite3_js_db_export(db);
}

function getDbSize(): number {
  const pageCount = db.exec("PRAGMA page_count", { returnValue: "resultRows" })[0][0] as number;
  const pageSize = db.exec("PRAGMA page_size", { returnValue: "resultRows" })[0][0] as number;
  return pageCount * pageSize;
}

initDb()
  .then(() => {
    self.postMessage({ type: "READY" });

    self.onmessage = async (event: MessageEvent<RequestMessage>) => {
      const msg = event.data;
      try {
        switch (msg.type) {
          case "UPSERT_GAMES_WITH_MOVES":
            upsertGamesWithMoves(msg.entries);
            reply(msg.id, null);
            break;
          case "GET_MOVES_FOR_POSITION":
            reply(msg.id, getMovesForPosition(msg.fenHash, msg.includeUsernames));
            break;
          case "GET_POSITION_DATA":
            reply(msg.id, getPositionData(msg.fenHash, msg.includeUsernames));
            break;
          case "GET_GAMES_BY_UUIDS":
            reply(msg.id, getGamesByUuids(msg.uuids));
            break;
          case "GET_STOCKFISH_EVAL":
            reply(msg.id, getStockfishEval(msg.fenHash));
            break;
          case "UPSERT_STOCKFISH_EVAL":
            upsertStockfishEval(msg.row);
            reply(msg.id, null);
            break;
          case "CLEAR":
            await resetDb();
            reply(msg.id, null);
            break;
          case "GET_DB_SIZE":
            reply(msg.id, getDbSize());
            break;
          case "EXPORT_DB": {
            const bytes = exportDb();
            reply(msg.id, bytes, undefined, [bytes.buffer]);
            break;
          }
          case "UPSERT_ARCHIVES":
            upsertArchives(msg.rows);
            reply(msg.id, null);
            break;
          case "GET_ARCHIVES_LAST_MODIFIED_FOR_USER":
            reply(msg.id, getArchivesLastModifiedForUser(msg.username));
            break;
          case "TOUCH_ARCHIVES_CHECKED":
            touchArchivesChecked(msg.rows);
            reply(msg.id, null);
            break;
          case "LIST_PLAYERS":
            reply(msg.id, listPlayers());
            break;
          case "DELETE_PLAYER":
            deletePlayer(msg.username);
            reply(msg.id, null);
            break;
          case "LIST_BOOKMARKS":
            reply(msg.id, listBookmarks());
            break;
          case "ADD_BOOKMARK":
            addBookmark(msg.fragment, msg.name);
            reply(msg.id, null);
            break;
          case "REMOVE_BOOKMARK":
            removeBookmark(msg.fragment);
            reply(msg.id, null);
            break;
          case "SET_BOOKMARK_NAME":
            setBookmarkName(msg.fragment, msg.name);
            reply(msg.id, null);
            break;
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        reply(msg.id, null, message);
      }
    };
  })
  .catch((e) => {
    self.postMessage({ type: "ERROR", error: e instanceof Error ? e.message : String(e) });
  });
