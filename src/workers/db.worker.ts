import type { Sqlite3Static } from "@sqlite.org/sqlite-wasm";

import type { StockfishEvalRecord } from "../lib/stockfishEval";
import type { GameRecord, MoveRecord } from "../lib/gamesDb";

type ArchiveUpsertRow = {
  username: string;
  path: string;
  fetchedAt: number;
  gzipJson: Uint8Array;
  /** HTTP `Last-Modified` from the archive response (metadata; browser cannot send `If-Modified-Since` to chess.com). */
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
  | { type: "GET_GAMES_BY_UUIDS"; id: number; uuids: string[] }
  | { type: "GET_STOCKFISH_EVAL"; id: number; fenHash: string }
  | { type: "UPSERT_STOCKFISH_EVAL"; id: number; row: StockfishEvalRecord }
  | { type: "CLEAR"; id: number }
  | { type: "GET_DB_SIZE"; id: number }
  | { type: "EXPORT_DB"; id: number }
  | { type: "UPSERT_ARCHIVES"; id: number; rows: ArchiveUpsertRow[] }
  | { type: "GET_ARCHIVES_LAST_MODIFIED_FOR_USER"; id: number; username: string }
  | { type: "TOUCH_PLAYER_SYNC"; id: number; username: string; syncedAt: number }
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
  uuid TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  username TEXT NOT NULL,
  whiteUsername TEXT NOT NULL DEFAULT '',
  blackUsername TEXT NOT NULL DEFAULT '',
  whiteRating INTEGER,
  blackRating INTEGER,
  endTime INTEGER,
  timeClass TEXT,
  rated INTEGER,
  eco TEXT,
  fen TEXT,
  initialSetup TEXT,
  rules TEXT,
  timeControl TEXT,
  site TEXT,
  event TEXT,
  pgn TEXT,
  result TEXT,
  importedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS moves (
  id TEXT PRIMARY KEY,
  gameId TEXT NOT NULL,
  fenHashBefore TEXT NOT NULL,
  san TEXT NOT NULL,
  fenHashAfter TEXT NOT NULL,
  result TEXT,
  userColor TEXT,
  winKind TEXT
);
CREATE INDEX IF NOT EXISTS idx_games_username ON games(username);
CREATE INDEX IF NOT EXISTS idx_games_endTime ON games(endTime);
CREATE INDEX IF NOT EXISTS idx_moves_fenHashBefore ON moves(fenHashBefore);
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
  gzip_json BLOB NOT NULL,
  last_modified TEXT,
  PRIMARY KEY (username, path)
);
CREATE INDEX IF NOT EXISTS idx_archives_username ON archives(username);
CREATE TABLE IF NOT EXISTS player_sync_meta (
  username TEXT PRIMARY KEY,
  last_sync_at INTEGER
);
CREATE TABLE IF NOT EXISTS bookmarks (
  fragment TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT ''
);
`;

type Database = InstanceType<Sqlite3Static["oo1"]["DB"]>;

let sqlite3: Sqlite3Static;
let db: Database;

async function initDb() {
  const moduleUrl = new URL("/sqlite3/index.mjs", self.location.href).href;
  const { default: sqlite3InitModule } = await import(moduleUrl);
  sqlite3 = await sqlite3InitModule();

  const poolUtil = await sqlite3.installOpfsSAHPoolVfs({
    initialCapacity: 6,
    clearOnInit: false,
    name: "opfs-sahpool",
  });

  db = new poolUtil.OpfsSAHPoolDb("/opening-tracker.db");
  db.exec(SCHEMA);
  migrateArchivesBlobColumn();
  migrateArchivesLastModifiedColumn();
  migrateBookmarksNameColumn();
}

function migrateBookmarksNameColumn() {
  let cols: { name: string }[];
  try {
    cols = db.exec("PRAGMA table_info(bookmarks)", {
      rowMode: "object",
      returnValue: "resultRows",
    }) as unknown as { name: string }[];
  } catch {
    return;
  }
  if (!Array.isArray(cols) || cols.length === 0) return;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("name")) {
    db.exec("ALTER TABLE bookmarks ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  }
}

/** Older builds used `body`; keep one-file backups coherent by renaming to `gzip_json`. */
function migrateArchivesBlobColumn() {
  let cols: { name: string }[];
  try {
    cols = db.exec("PRAGMA table_info(archives)", {
      rowMode: "object",
      returnValue: "resultRows",
    }) as unknown as { name: string }[];
  } catch {
    return;
  }
  if (!Array.isArray(cols) || cols.length === 0) return;
  const names = new Set(cols.map((c) => c.name));
  if (names.has("body") && !names.has("gzip_json")) {
    db.exec("ALTER TABLE archives RENAME COLUMN body TO gzip_json");
  }
}

function migrateArchivesLastModifiedColumn() {
  let cols: { name: string }[];
  try {
    cols = db.exec("PRAGMA table_info(archives)", {
      rowMode: "object",
      returnValue: "resultRows",
    }) as unknown as { name: string }[];
  } catch {
    return;
  }
  if (!Array.isArray(cols) || cols.length === 0) return;
  const names = new Set(cols.map((c) => c.name));
  if (names.has("last_modified")) return;
  if (names.has("etag")) {
    db.exec("ALTER TABLE archives RENAME COLUMN etag TO last_modified");
    return;
  }
  db.exec("ALTER TABLE archives ADD COLUMN last_modified TEXT");
}

function upsertGamesWithMoves(entries: { record: GameRecord; moves: MoveRecord[] }[]) {
  db.exec("BEGIN");
  try {
    const delMoves = db.prepare("DELETE FROM moves WHERE gameId = ?");
    const insGame = db.prepare(
      `INSERT OR REPLACE INTO games (uuid, url, username, whiteUsername, blackUsername,
        whiteRating, blackRating, endTime, timeClass, rated, eco, fen, initialSetup,
        rules, timeControl, site, event, pgn, result, importedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const insMove = db.prepare(
      `INSERT OR REPLACE INTO moves (id, gameId, fenHashBefore, san, fenHashAfter, result, userColor, winKind)
       VALUES (?,?,?,?,?,?,?,?)`,
    );

    try {
      for (const { record: g, moves } of entries) {
        delMoves.bind([g.uuid]).stepReset();
        insGame
          .bind([
            g.uuid, g.url, g.username, g.whiteUsername, g.blackUsername,
            g.whiteRating, g.blackRating, g.endTime, g.timeClass,
            g.rated === null ? null : g.rated ? 1 : 0,
            g.eco, g.fen, g.initialSetup, g.rules, g.timeControl,
            g.site, g.event, g.pgn, g.result, g.importedAt,
          ])
          .stepReset();
        for (const m of moves) {
          insMove
            .bind([m.id, m.gameId, m.fenHashBefore, m.san, m.fenHashAfter, m.result ?? null, m.userColor ?? null, m.winKind ?? null])
            .stepReset();
        }
      }
    } finally {
      delMoves.finalize();
      insGame.finalize();
      insMove.finalize();
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function getMovesForPosition(fenHash: string, includeUsernames?: string[]): MoveRecord[] {
  if (includeUsernames !== undefined && includeUsernames.length === 0) {
    return [];
  }
  if (includeUsernames !== undefined && includeUsernames.length > 0) {
    const placeholders = includeUsernames.map(() => "?").join(",");
    const sql = `SELECT m.* FROM moves m
      INNER JOIN games g ON g.uuid = m.gameId
      WHERE m.fenHashBefore = ? AND g.username IN (${placeholders})`;
    return db.exec(sql, {
      bind: [fenHash, ...includeUsernames],
      rowMode: "object",
      returnValue: "resultRows",
    }) as unknown as MoveRecord[];
  }
  return db.exec("SELECT * FROM moves WHERE fenHashBefore = ?", {
    bind: [fenHash],
    rowMode: "object",
    returnValue: "resultRows",
  }) as unknown as MoveRecord[];
}

function getGamesByUuids(uuids: string[]): GameRecord[] {
  if (uuids.length === 0) return [];
  const placeholders = uuids.map(() => "?").join(",");
  return db.exec(`SELECT * FROM games WHERE uuid IN (${placeholders})`, {
    bind: uuids,
    rowMode: "object",
    returnValue: "resultRows",
  }) as unknown as GameRecord[];
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
    `INSERT OR REPLACE INTO archives (username, path, fetched_at, gzip_json, last_modified) VALUES (?,?,?,?,?)`,
  );
  try {
    for (const r of rows) {
      stmt
        .bind(1, r.username)
        .bind(2, r.path)
        .bind(3, r.fetchedAt)
        .bindAsBlob(4, r.gzipJson)
        .bind(5, r.lastModified ?? null)
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

function touchPlayerSync(username: string, syncedAt: number) {
  const u = username.trim().toLowerCase();
  if (!u || !Number.isFinite(syncedAt)) return;
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO player_sync_meta (username, last_sync_at) VALUES (?, ?)`,
  );
  try {
    stmt.bind(1, u).bind(2, Math.floor(syncedAt)).stepReset();
  } finally {
    stmt.finalize();
  }
}

function listPlayers(): PlayerListRow[] {
  const sql = `
    WITH users AS (
      SELECT DISTINCT username FROM games
      UNION
      SELECT DISTINCT username FROM archives
      UNION
      SELECT DISTINCT username FROM player_sync_meta
    )
    SELECT
      u.username AS username,
      (SELECT COUNT(*) FROM games g WHERE g.username = u.username) AS gameCount,
      (SELECT MIN(a.path) FROM archives a WHERE a.username = u.username) AS minArchivePath,
      (SELECT MAX(a.path) FROM archives a WHERE a.username = u.username) AS maxArchivePath,
      COALESCE(
        (SELECT psm.last_sync_at FROM player_sync_meta psm WHERE psm.username = u.username),
        (SELECT MAX(a.fetched_at) FROM archives a WHERE a.username = u.username)
      ) AS lastSyncAt,
      (SELECT strftime('%Y/%m', datetime(MIN(g.endTime), 'unixepoch')) FROM games g
        WHERE g.username = u.username AND g.endTime IS NOT NULL) AS minGameEndMonth
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
    db.exec("DELETE FROM moves WHERE gameId IN (SELECT uuid FROM games WHERE username = ?)", {
      bind: [u],
    });
    db.exec("DELETE FROM games WHERE username = ?", { bind: [u] });
    db.exec("DELETE FROM archives WHERE username = ?", { bind: [u] });
    db.exec("DELETE FROM player_sync_meta WHERE username = ?", { bind: [u] });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function clearAll() {
  db.exec(
    "DELETE FROM moves; DELETE FROM games; DELETE FROM archives; DELETE FROM player_sync_meta; DELETE FROM stockfish_eval; DELETE FROM bookmarks; VACUUM;",
  );
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

    self.onmessage = (event: MessageEvent<RequestMessage>) => {
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
            clearAll();
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
          case "TOUCH_PLAYER_SYNC":
            touchPlayerSync(msg.username, msg.syncedAt);
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
