import pgnParser from "pgn-parser";

import { isStandardImportStart } from "./startFen";

const DB_NAME = "openingTracker";
const DB_VERSION = 3;
const GAMES_STORE = "games";
const MOVES_STORE = "moves";

export type MoveRecord = {
  id: string;
  gameId: string;
  /** 64-bit Zobrist key from `bitboard-chess` `getZobristKey()`, hex string (16 chars). */
  fenHashBefore: string;
  san: string;
  fenHashAfter: string;
  /** PGN Result header: "1-0", "0-1", "1/2-1/2", or "*". Optional for pre-existing records. */
  result?: string;
  /** Which color the imported user played: "w" or "b". Optional for pre-existing records. */
  userColor?: "w" | "b";
  /** How the user won within the opening window: "trap" (material ≥ +3), "mate" (early checkmate), or omitted for regular wins/non-wins. */
  winKind?: "trap" | "mate";
};

export type GameRecord = {
  uuid: string;
  url: string;
  username: string;
  whiteUsername: string;
  blackUsername: string;
  whiteRating: number | null;
  blackRating: number | null;
  endTime: number | null;
  timeClass: string | null;
  rated: boolean | null;
  eco: string | null;
  /** Final position on Chess.com (matches PGN `[CurrentPosition]`). Not the start FEN for replay. */
  fen: string | null;
  /** Starting position from the API (`initial_setup`). Use this (or default) when replaying the PGN from move 1. */
  initialSetup: string | null;
  rules: string | null;
  timeControl: string | null;
  site: string | null;
  event: string | null;
  pgn: string | null;
  /** PGN Result header: "1-0", "0-1", "1/2-1/2", or "*". */
  result: string | null;
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

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function openGamesDb(): Promise<IDBDatabase> {
  const request = indexedDB.open(DB_NAME, DB_VERSION);

  request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
    const db = request.result;
    const oldVersion = event.oldVersion;

    if (oldVersion < 3 && db.objectStoreNames.contains(MOVES_STORE)) {
      db.deleteObjectStore(MOVES_STORE);
    }

    let store: IDBObjectStore;

    if (db.objectStoreNames.contains(GAMES_STORE)) {
      store = request.transaction!.objectStore(GAMES_STORE);
    } else {
      store = db.createObjectStore(GAMES_STORE, { keyPath: "uuid" });
    }

    if (!store.indexNames.contains("username")) {
      store.createIndex("username", "username", { unique: false });
    }
    if (!store.indexNames.contains("endTime")) {
      store.createIndex("endTime", "endTime", { unique: false });
    }
    if (!store.indexNames.contains("timeClass")) {
      store.createIndex("timeClass", "timeClass", { unique: false });
    }
    if (!store.indexNames.contains("eco")) {
      store.createIndex("eco", "eco", { unique: false });
    }

    let movesStore: IDBObjectStore;
    if (db.objectStoreNames.contains(MOVES_STORE)) {
      movesStore = request.transaction!.objectStore(MOVES_STORE);
    } else {
      movesStore = db.createObjectStore(MOVES_STORE, { keyPath: "id" });
    }

    if (!movesStore.indexNames.contains("fenHashBefore")) {
      movesStore.createIndex("fenHashBefore", "fenHashBefore", { unique: false });
    }
    if (!movesStore.indexNames.contains("fenHashBeforeSan")) {
      movesStore.createIndex("fenHashBeforeSan", ["fenHashBefore", "san"], { unique: false });
    }
  };

  return requestToPromise(request);
}

export async function upsertGames(records: GameRecord[]): Promise<void> {
  if (records.length === 0) {
    return;
  }

  const db = await openGamesDb();

  try {
    const tx = db.transaction(GAMES_STORE, "readwrite");
    const store = tx.objectStore(GAMES_STORE);

    for (const record of records) {
      store.put(record);
    }

    await transactionDone(tx);
  } finally {
    db.close();
  }
}

/** Replace each game row and its move rows (key-range delete on `id`, then insert moves). */
export async function upsertGamesWithMoves(
  entries: { record: GameRecord; moves: MoveRecord[] }[],
): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  const db = await openGamesDb();

  try {
    const tx = db.transaction([GAMES_STORE, MOVES_STORE], "readwrite");
    const gamesStore = tx.objectStore(GAMES_STORE);
    const movesStore = tx.objectStore(MOVES_STORE);

    for (const { record, moves } of entries) {
      const gameId = record.uuid;
      const range = IDBKeyRange.bound(`${gameId}:`, `${gameId}:\uffff`);
      movesStore.delete(range);
      gamesStore.put(record);
      for (const m of moves) {
        movesStore.put(m);
      }
    }

    await transactionDone(tx);
  } finally {
    db.close();
  }
}

export async function getMovesForPosition(fenHash: string): Promise<MoveRecord[]> {
  const db = await openGamesDb();

  try {
    const tx = db.transaction(MOVES_STORE, "readonly");
    const index = tx.objectStore(MOVES_STORE).index("fenHashBefore");
    return await requestToPromise(index.getAll(fenHash));
  } finally {
    db.close();
  }
}

export async function getGamesByUuids(uuids: string[]): Promise<Map<string, GameRecord>> {
  const unique = [...new Set(uuids)];
  if (unique.length === 0) {
    return new Map();
  }

  const db = await openGamesDb();

  try {
    const tx = db.transaction(GAMES_STORE, "readonly");
    const store = tx.objectStore(GAMES_STORE);
    const map = new Map<string, GameRecord>();

    await Promise.all(
      unique.map((uuid) =>
        requestToPromise(store.get(uuid)).then((g) => {
          if (g) map.set(uuid, g as GameRecord);
        }),
      ),
    );

    return map;
  } finally {
    db.close();
  }
}

export async function clearGamesStore(): Promise<void> {
  const db = await openGamesDb();

  try {
    const tx = db.transaction([GAMES_STORE, MOVES_STORE], "readwrite");
    tx.objectStore(GAMES_STORE).clear();
    tx.objectStore(MOVES_STORE).clear();
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function parsePgnHeaders(pgn: string | null): {
  timeControl: string | null;
  site: string | null;
  event: string | null;
  result: string | null;
} {
  if (!pgn) {
    return { timeControl: null, site: null, event: null, result: null };
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
      timeControl: values.get("timecontrol") ?? null,
      site: values.get("site") ?? null,
      event: values.get("event") ?? null,
      result: values.get("result") ?? null,
    };
  } catch {
    return { timeControl: null, site: null, event: null, result: null };
  }
}

export function toGameRecord(game: ChessArchiveGame, username: string): GameRecord | null {
  const uuid = asString(game.uuid);
  const url = asString(game.url);

  if (!uuid || !url) {
    return null;
  }

  const pgn = asString(game.pgn);
  const initialSetup = asString(game.initial_setup);

  if (!isStandardImportStart(pgn, initialSetup)) {
    return null;
  }

  const pgnHeaders = parsePgnHeaders(pgn);

  return {
    uuid,
    url,
    username,
    whiteUsername: asString(game.white?.username) ?? "",
    blackUsername: asString(game.black?.username) ?? "",
    whiteRating: asNumber(game.white?.rating),
    blackRating: asNumber(game.black?.rating),
    endTime: asNumber(game.end_time),
    timeClass: asString(game.time_class),
    rated: asBoolean(game.rated),
    eco: asString(game.eco),
    fen: asString(game.fen),
    initialSetup,
    rules: asString(game.rules),
    timeControl: pgnHeaders.timeControl ?? asString(game.time_control),
    site: pgnHeaders.site,
    event: pgnHeaders.event,
    pgn,
    result: pgnHeaders.result,
    importedAt: Date.now(),
  };
}
