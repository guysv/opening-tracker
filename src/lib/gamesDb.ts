import pgnParser from "pgn-parser";

const DB_NAME = "openingExplorer";
const DB_VERSION = 1;
const GAMES_STORE = "games";

export type GameRecord = {
  uuid: string;
  url: string;
  username: string;
  whiteUsername: string;
  blackUsername: string;
  endTime: number | null;
  timeClass: string | null;
  rated: boolean | null;
  eco: string | null;
  fen: string | null;
  rules: string | null;
  timeControl: string | null;
  site: string | null;
  event: string | null;
  pgn: string | null;
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
  rules?: unknown;
  time_control?: unknown;
  white?: {
    username?: unknown;
  };
  black?: {
    username?: unknown;
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

  request.onupgradeneeded = () => {
    const db = request.result;
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

export async function clearGamesStore(): Promise<void> {
  const db = await openGamesDb();

  try {
    const tx = db.transaction(GAMES_STORE, "readwrite");
    tx.objectStore(GAMES_STORE).clear();
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
} {
  if (!pgn) {
    return { timeControl: null, site: null, event: null };
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
    };
  } catch {
    return { timeControl: null, site: null, event: null };
  }
}

export function toGameRecord(game: ChessArchiveGame, username: string): GameRecord | null {
  const uuid = asString(game.uuid);
  const url = asString(game.url);

  if (!uuid || !url) {
    return null;
  }

  const pgn = asString(game.pgn);
  const pgnHeaders = parsePgnHeaders(pgn);

  return {
    uuid,
    url,
    username,
    whiteUsername: asString(game.white?.username) ?? "",
    blackUsername: asString(game.black?.username) ?? "",
    endTime: asNumber(game.end_time),
    timeClass: asString(game.time_class),
    rated: asBoolean(game.rated),
    eco: asString(game.eco),
    fen: asString(game.fen),
    rules: asString(game.rules),
    timeControl: pgnHeaders.timeControl ?? asString(game.time_control),
    site: pgnHeaders.site,
    event: pgnHeaders.event,
    pgn,
    importedAt: Date.now(),
  };
}
