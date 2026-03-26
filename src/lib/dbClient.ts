import type { GameRecord, MoveRecord } from "./gamesDb";
import type { StockfishEvalRecord } from "./stockfishEval";

export type PlayerListRow = {
  username: string;
  gameCount: number;
  minArchivePath: string | null;
  maxArchivePath: string | null;
  lastSyncAt: number | null;
  minGameEndMonth: string | null;
};

/** One month archive: raw chess.com JSON response, gzip-compressed, stored as a SQLite BLOB (`archives.gzip_json`). */
export type ArchiveUpsertRow = {
  username: string;
  path: string;
  fetchedAt: number;
  checkedAt: number;
  gzipJson: Uint8Array;
  lastModified: string | null;
};

export type ArchiveCheckedRow = {
  username: string;
  path: string;
  checkedAt: number;
  lastModified: string | null;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

let worker: Worker | null = null;
let readyPromise: Promise<void> | null = null;
let nextId = 1;
const pending = new Map<number, PendingRequest>();

function getWorker(): Worker {
  if (!worker) throw new Error("DB not initialized — call initDb() first");
  return worker;
}

async function waitForReady(): Promise<void> {
  if (!readyPromise) {
    initDb();
  }
  await readyPromise;
}

async function request<T>(msg: Record<string, unknown>): Promise<T> {
  await waitForReady();
  const id = nextId++;
  msg.id = id;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    getWorker().postMessage(msg);
  });
}

export function initDb(resetOnInit = false): Promise<void> {
  if (readyPromise) return readyPromise;

  const workerUrl = new URL("../workers/db.worker.js", import.meta.url);
  if (resetOnInit) {
    workerUrl.searchParams.set("resetOnInit", "1");
  }
  worker = new Worker(workerUrl, { type: "module" });

  readyPromise = new Promise<void>((resolve, reject) => {
    worker!.onmessage = (event: MessageEvent) => {
      const data = event.data;

      if (data?.type === "READY") {
        worker!.onmessage = handleMessage;
        resolve();
        return;
      }

      if (data?.type === "ERROR") {
        reject(new Error(data.error ?? "DB worker failed to initialize"));
        return;
      }

      handleMessage(event);
    };
  });

  return readyPromise;
}

function handleMessage(event: MessageEvent) {
  const { id, result, error } = event.data ?? {};
  if (id == null) return;
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  if (error) {
    entry.reject(new Error(error));
  } else {
    entry.resolve(result);
  }
}

export async function upsertGamesWithMoves(
  entries: { record: GameRecord; moves: MoveRecord[] }[],
): Promise<void> {
  if (entries.length === 0) return;
  await request({ type: "UPSERT_GAMES_WITH_MOVES", entries });
}

export async function getMovesForPosition(
  fenHash: string,
  includeUsernames?: string[],
): Promise<MoveRecord[]> {
  const msg: Record<string, unknown> = { type: "GET_MOVES_FOR_POSITION", fenHash };
  if (includeUsernames !== undefined) {
    msg.includeUsernames = includeUsernames;
  }
  return (await request<MoveRecord[]>(msg)) ?? [];
}

export async function getStockfishEval(fenHash: string): Promise<StockfishEvalRecord | null> {
  return (await request<StockfishEvalRecord | null>({ type: "GET_STOCKFISH_EVAL", fenHash })) ?? null;
}

export async function upsertStockfishEval(row: StockfishEvalRecord): Promise<void> {
  await request({ type: "UPSERT_STOCKFISH_EVAL", row });
}

export async function getGamesByUuids(uuids: number[]): Promise<Map<number, GameRecord>> {
  const unique = [...new Set(uuids)];
  if (unique.length === 0) return new Map();
  const rows = await request<GameRecord[]>({ type: "GET_GAMES_BY_UUIDS", uuids: unique });
  const map = new Map<number, GameRecord>();
  for (const g of rows ?? []) {
    if (Number.isFinite(g.gameKey)) map.set(g.gameKey, g);
  }
  return map;
}

export async function clearGamesStore(): Promise<void> {
  await request({ type: "CLEAR" });
}

export async function upsertArchives(rows: ArchiveUpsertRow[]): Promise<void> {
  if (rows.length === 0) return;
  await request({ type: "UPSERT_ARCHIVES", rows });
}

export async function touchArchivesChecked(rows: ArchiveCheckedRow[]): Promise<void> {
  if (rows.length === 0) return;
  await request({ type: "TOUCH_ARCHIVES_CHECKED", rows });
}

/** Per-archive stored `Last-Modified` (from prior GETs). Keys are `YYYY/MM` paths. */
export async function getArchivesLastModifiedForUser(
  username: string,
): Promise<Record<string, string | null>> {
  const u = username.trim().toLowerCase();
  if (!u) return {};
  return (
    (await request<Record<string, string | null>>({
      type: "GET_ARCHIVES_LAST_MODIFIED_FOR_USER",
      username: u,
    })) ?? {}
  );
}

export async function listPlayers(): Promise<PlayerListRow[]> {
  return (await request<PlayerListRow[]>({ type: "LIST_PLAYERS" })) ?? [];
}

export async function deletePlayer(username: string): Promise<void> {
  await request({ type: "DELETE_PLAYER", username: username.trim().toLowerCase() });
}

export async function getDbSize(): Promise<number> {
  return (await request<number>({ type: "GET_DB_SIZE" })) ?? 0;
}

export async function exportDb(): Promise<Uint8Array> {
  return await request<Uint8Array>({ type: "EXPORT_DB" });
}

export type BookmarkRow = { fragment: string; created_at: number; name: string };

export async function listBookmarks(): Promise<BookmarkRow[]> {
  return (await request<BookmarkRow[]>({ type: "LIST_BOOKMARKS" })) ?? [];
}

export async function addBookmark(fragment: string, name: string): Promise<void> {
  await request({ type: "ADD_BOOKMARK", fragment, name });
}

export async function setBookmarkName(fragment: string, name: string): Promise<void> {
  await request({ type: "SET_BOOKMARK_NAME", fragment, name });
}

export async function removeBookmark(fragment: string): Promise<void> {
  await request({ type: "REMOVE_BOOKMARK", fragment });
}
