import type { Sqlite3Static } from "@sqlite.org/sqlite-wasm";

import type { GameRecord, MoveRecord } from "../lib/gamesDb";

type RequestMessage =
  | { type: "UPSERT_GAMES_WITH_MOVES"; id: number; entries: { record: GameRecord; moves: MoveRecord[] }[] }
  | { type: "GET_MOVES_FOR_POSITION"; id: number; fenHash: string }
  | { type: "GET_GAMES_BY_UUIDS"; id: number; uuids: string[] }
  | { type: "CLEAR"; id: number }
  | { type: "GET_DB_SIZE"; id: number }
  | { type: "EXPORT_DB"; id: number };

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

function getMovesForPosition(fenHash: string): MoveRecord[] {
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

function clearAll() {
  db.exec("DELETE FROM moves; DELETE FROM games; VACUUM;");
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
            reply(msg.id, getMovesForPosition(msg.fenHash));
            break;
          case "GET_GAMES_BY_UUIDS":
            reply(msg.id, getGamesByUuids(msg.uuids));
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
