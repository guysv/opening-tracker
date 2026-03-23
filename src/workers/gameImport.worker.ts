import {
  parseChessComPgnOnce,
  toGameRecord,
  type ChessArchiveGame,
  type GameRecord,
  type MoveRecord,
  type ParseChessComPgnResult,
} from "../lib/gamesDb";
import {
  getArchivePathsBefore,
  getArchivePathsForMonthsBack,
  syncMonthsToFetch,
} from "../lib/archivePaths";
import { truncateGameRecordForStorage } from "../lib/gameMoves";

const CHESS_PUB_BASE = "https://api.chess.com/pub/";

/**
 * Conditional **request** headers (`If-Modified-Since`, `If-None-Match`) are blocked by CORS
 * preflight on chess.com. We can still send a simple `HEAD` (no preflight), read
 * `Last-Modified` (safelisted response header), compare to SQLite, and skip `GET` when unchanged.
 * Months with no row yet use a single `GET` only (no `HEAD`).
 */

type ImportRequestMessage =
  | {
      type: "IMPORT_INITIAL";
      payload: {
        username: string;
        monthsBack: number;
        archiveLastModifiedByPath?: Record<string, string | null>;
      };
    }
  | {
      type: "IMPORT_SYNC";
      payload: {
        username: string;
        lastSyncAt: number | null;
        maxArchivePath: string | null;
        archiveLastModifiedByPath?: Record<string, string | null>;
      };
    }
  | {
      type: "IMPORT_EXTEND";
      payload: {
        username: string;
        oldestPath: string;
        extendMonths: number;
        archiveLastModifiedByPath?: Record<string, string | null>;
      };
    };

type ImportErrorMessage = {
  type: "IMPORT_ERROR";
  payload: { message: string };
};

type ImportProgressMessage = {
  type: "IMPORT_PROGRESS";
  payload:
    | { phase: "download"; current: number; total: number }
    | { phase: "parse"; current: number; total: number }
    | { phase: "save" };
};

type ArchiveBatchItem = {
  username: string;
  path: string;
  fetchedAt: number;
  gzipJson: Uint8Array;
  lastModified: string | null;
};

type ParseBatchResultMessage = {
  type: "PARSE_BATCH_RESULT";
  payload: {
    requestId: number;
    results: { gameId: string; moves: MoveRecord[] }[];
  };
};

async function gzipRawBytes(raw: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(raw.byteLength);
  copy.set(raw);
  const stream = new Blob([copy]).stream().pipeThrough(new CompressionStream("gzip"));
  const out = await new Response(stream).arrayBuffer();
  return new Uint8Array(out);
}

function responseLastModified(headers: Headers): string | null {
  const raw = headers.get("last-modified");
  if (raw == null) return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

function postError(message: string): void {
  const payload: ImportErrorMessage = { type: "IMPORT_ERROR", payload: { message } };
  self.postMessage(payload);
}

function postProgress(progress: ImportProgressMessage["payload"]): void {
  self.postMessage({ type: "IMPORT_PROGRESS", payload: progress } satisfies ImportProgressMessage);
}

function parsePoolSize(recordCount: number): number {
  const hw =
    typeof navigator !== "undefined" && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 4;
  return Math.max(1, Math.min(recordCount, hw));
}

function shardRoundRobin(records: GameRecord[], poolSize: number): GameRecord[][] {
  const chunks: GameRecord[][] = Array.from({ length: poolSize }, () => []);
  for (let i = 0; i < records.length; i++) {
    chunks[i % poolSize]!.push(records[i]!);
  }
  return chunks;
}

async function parseRecordsWithWorkerPool(records: GameRecord[]): Promise<Map<string, MoveRecord[]>> {
  const map = new Map<string, MoveRecord[]>();

  if (records.length === 0) {
    postProgress({ phase: "parse", current: 0, total: 0 });
    return map;
  }

  postProgress({ phase: "parse", current: 0, total: records.length });

  const poolSize = parsePoolSize(records.length);
  const chunks = shardRoundRobin(records, poolSize);
  const workers: Worker[] = [];
  let parsedCount = 0;

  try {
    const promises = chunks.map(
      (games, workerIndex) =>
        new Promise<{ gameId: string; moves: MoveRecord[] }[]>((resolve, reject) => {
          if (games.length === 0) {
            resolve([]);
            return;
          }

          const worker = new Worker(new URL("./gameParse.worker.js", import.meta.url), {
            type: "module",
          });
          workers.push(worker);

          worker.onmessage = (event: MessageEvent<ParseBatchResultMessage>) => {
            const data = event.data;
            if (
              data?.type === "PARSE_BATCH_RESULT" &&
              data.payload?.requestId === workerIndex
            ) {
              resolve(data.payload.results);
            }
          };

          worker.onerror = (ev: Event) => {
            const e = ev as ErrorEvent;
            const detail = e.message?.trim() || "unknown error";
            reject(new Error(`Parse worker failed: ${detail}`));
          };

          try {
            worker.postMessage({
              type: "PARSE_BATCH",
              payload: { requestId: workerIndex, games },
            });
          } catch (postErr) {
            reject(postErr instanceof Error ? postErr : new Error(String(postErr)));
          }
        }).then((results) => {
          parsedCount += results.length;
          postProgress({ phase: "parse", current: parsedCount, total: records.length });
          return results;
        }),
    );

    const parts = await Promise.all(promises);

    for (const part of parts) {
      for (const { gameId, moves } of part) {
        map.set(gameId, moves);
      }
    }
  } finally {
    for (const w of workers) {
      w.terminate();
    }
  }

  return map;
}

async function downloadArchives(
  normalizedUsername: string,
  paths: string[],
  archiveLastModifiedByPath: Record<string, string | null> | undefined,
): Promise<{ games: ChessArchiveGame[]; archives: ArchiveBatchItem[] }> {
  const allGames: ChessArchiveGame[] = [];
  const archives: ArchiveBatchItem[] = [];
  const dec = new TextDecoder();
  const cache = archiveLastModifiedByPath ?? {};

  async function consumeGetResponse(response: Response, archivePath: string): Promise<void> {
    if (response.status === 404) return;
    if (!response.ok) {
      throw new Error(`Archive ${archivePath} failed (${response.status}).`);
    }

    const raw = new Uint8Array(await response.arrayBuffer());

    const fetchedAt = Date.now();
    const lastModified = responseLastModified(response.headers);
    const gz = await gzipRawBytes(raw);
    const gzipOwned = new Uint8Array(gz);

    archives.push({
      username: normalizedUsername,
      path: archivePath,
      fetchedAt,
      gzipJson: gzipOwned,
      lastModified,
    });

    let data: { games?: unknown };
    try {
      data = JSON.parse(dec.decode(raw)) as { games?: unknown };
    } catch {
      throw new Error(`Invalid JSON in archive ${archivePath}.`);
    }

    if (!Array.isArray(data.games)) {
      throw new Error(`Invalid archive response for ${archivePath}: missing games array.`);
    }

    allGames.push(...(data.games as ChessArchiveGame[]));
  }

  for (let i = 0; i < paths.length; i++) {
    const archivePath = paths[i]!;
    const archiveUrl = new URL(
      `player/${normalizedUsername}/games/${archivePath}`,
      CHESS_PUB_BASE,
    ).href;

    const hasCachedArchive = Object.prototype.hasOwnProperty.call(cache, archivePath);

    if (!hasCachedArchive) {
      const response = await fetch(archiveUrl);
      await consumeGetResponse(response, archivePath);
      postProgress({ phase: "download", current: i + 1, total: paths.length });
      continue;
    }

    const head = await fetch(archiveUrl, { method: "HEAD" });
    if (head.status === 404) {
      postProgress({ phase: "download", current: i + 1, total: paths.length });
      continue;
    }

    let needGet = true;
    if (head.ok) {
      const headLm = responseLastModified(head.headers);
      const cachedLm = cache[archivePath];
      if (headLm != null && cachedLm === headLm) {
        needGet = false;
      }
    }

    if (!needGet) {
      postProgress({ phase: "download", current: i + 1, total: paths.length });
      continue;
    }

    const response = await fetch(archiveUrl);
    await consumeGetResponse(response, archivePath);
    postProgress({ phase: "download", current: i + 1, total: paths.length });
  }

  return { games: allGames, archives };
}

async function buildEntriesFromGames(
  allGames: ChessArchiveGame[],
  normalizedUsername: string,
): Promise<{ record: GameRecord; moves: MoveRecord[] }[]> {
  const filteredRecords: GameRecord[] = [];
  const truncateCaches: Array<ParseChessComPgnResult | undefined> = [];

  for (const game of allGames) {
    const pgn = typeof game.pgn === "string" && game.pgn.length > 0 ? game.pgn : null;
    const parsedOnce = pgn ? parseChessComPgnOnce(pgn) : null;
    const record = toGameRecord(game, normalizedUsername, parsedOnce ?? undefined);
    if (record) {
      filteredRecords.push(record);
      truncateCaches.push(parsedOnce ?? undefined);
    }
  }

  const records = filteredRecords.map((record, idx) =>
    truncateGameRecordForStorage(record, truncateCaches[idx]),
  );

  const movesByGame = await parseRecordsWithWorkerPool(records);
  const entries = records.map((record) => ({
    record,
    moves: movesByGame.get(record.uuid) ?? [],
  }));
  return entries.filter((e) => e.moves.length > 0);
}

function postImportResult(
  normalizedUsername: string,
  op: "initial" | "sync" | "extend",
  entries: { record: GameRecord; moves: MoveRecord[] }[],
  archives: ArchiveBatchItem[],
): void {
  self.postMessage({
    type: "IMPORT_ENTRIES",
    payload: { username: normalizedUsername, entries, op, archives },
  });
}

async function runImport(
  message: ImportRequestMessage,
  normalizedUsername: string,
): Promise<void> {
  let paths: string[] = [];
  let op: "initial" | "sync" | "extend" = "initial";

  if (message.type === "IMPORT_INITIAL") {
    op = "initial";
    const rawMonths = Number(message.payload.monthsBack);
    const monthsBack = Number.isFinite(rawMonths)
      ? Math.min(120, Math.max(1, Math.floor(rawMonths)))
      : 1;
    paths = getArchivePathsForMonthsBack(monthsBack);
  } else if (message.type === "IMPORT_SYNC") {
    op = "sync";
    const n = syncMonthsToFetch(
      message.payload.lastSyncAt,
      message.payload.maxArchivePath,
    );
    paths = getArchivePathsForMonthsBack(n);
  } else if (message.type === "IMPORT_EXTEND") {
    op = "extend";
    const raw = Number(message.payload.extendMonths);
    const extendMonths = Number.isFinite(raw) ? Math.min(120, Math.max(1, Math.floor(raw))) : 1;
    paths = getArchivePathsBefore(message.payload.oldestPath, extendMonths);
    if (paths.length === 0) {
      postError("Could not resolve older archives to extend.");
      return;
    }
  }

  if (paths.length === 0) {
    postImportResult(normalizedUsername, op, [], []);
    return;
  }

  const archiveLastModifiedByPath = message.payload.archiveLastModifiedByPath;
  const { games, archives } = await downloadArchives(
    normalizedUsername,
    paths,
    archiveLastModifiedByPath,
  );
  const entries = await buildEntriesFromGames(games, normalizedUsername);
  postImportResult(normalizedUsername, op, entries, archives);
}

self.onmessage = async (event: MessageEvent<ImportRequestMessage>) => {
  const message = event.data;
  if (
    message?.type !== "IMPORT_INITIAL" &&
    message?.type !== "IMPORT_SYNC" &&
    message?.type !== "IMPORT_EXTEND"
  ) {
    return;
  }

  const normalizedUsername = message.payload.username.trim().toLowerCase();
  if (!normalizedUsername) {
    postError("Username is required.");
    return;
  }

  try {
    await runImport(message, normalizedUsername);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown import error.";
    console.error("Import error:", messageText);
    postError(messageText);
  }
};
