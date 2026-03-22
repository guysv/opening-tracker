import type { GameRecord, MoveRecord } from "./gamesDb";
import type { StockfishEvalRecord } from "./stockfishEval";

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

export function initDb(): Promise<void> {
  if (readyPromise) return readyPromise;

  worker = new Worker(new URL("../workers/db.worker.js", import.meta.url), { type: "module" });

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

export async function getMovesForPosition(fenHash: string): Promise<MoveRecord[]> {
  return (await request<MoveRecord[]>({ type: "GET_MOVES_FOR_POSITION", fenHash })) ?? [];
}

export async function getStockfishEval(fenHash: string): Promise<StockfishEvalRecord | null> {
  return (await request<StockfishEvalRecord | null>({ type: "GET_STOCKFISH_EVAL", fenHash })) ?? null;
}

export async function upsertStockfishEval(row: StockfishEvalRecord): Promise<void> {
  await request({ type: "UPSERT_STOCKFISH_EVAL", row });
}

export async function getGamesByUuids(uuids: string[]): Promise<Map<string, GameRecord>> {
  const unique = [...new Set(uuids)];
  if (unique.length === 0) return new Map();
  const rows = await request<GameRecord[]>({ type: "GET_GAMES_BY_UUIDS", uuids: unique });
  const map = new Map<string, GameRecord>();
  for (const g of rows ?? []) {
    if (g.uuid) map.set(g.uuid, g);
  }
  return map;
}

export async function clearGamesStore(): Promise<void> {
  await request({ type: "CLEAR" });
}

export async function getDbSize(): Promise<number> {
  return (await request<number>({ type: "GET_DB_SIZE" })) ?? 0;
}

export async function exportDb(): Promise<Uint8Array> {
  return await request<Uint8Array>({ type: "EXPORT_DB" });
}
