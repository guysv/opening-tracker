import {
  toGameRecord,
  upsertGamesWithMoves,
  type ChessArchiveGame,
  type GameRecord,
  type MoveRecord,
} from "../lib/gamesDb";
import { truncateGameRecordForStorage } from "../lib/gameMoves";

type ImportRequestMessage = {
  type: "IMPORT_LATEST_ARCHIVE";
  payload: {
    username: string;
    monthsBack: number;
  };
};

type ImportSuccessMessage = {
  type: "IMPORT_SUCCESS";
  payload: {
    username: string;
    importedCount: number;
    monthsBack: number;
  };
};

type ImportErrorMessage = {
  type: "IMPORT_ERROR";
  payload: {
    message: string;
  };
};

type ImportProgressMessage = {
  type: "IMPORT_PROGRESS";
  payload:
    | { phase: "download"; current: number; total: number }
    | { phase: "parse"; current: number; total: number }
    | { phase: "save" };
};

type ParseBatchResultMessage = {
  type: "PARSE_BATCH_RESULT";
  payload: {
    requestId: number;
    results: { gameId: string; moves: MoveRecord[] }[];
  };
};

/** `YYYY/MM` paths from current UTC month going back `count` months (inclusive). */
function getArchivePathsForMonthsBack(count: number): string[] {
  const paths: string[] = [];
  const now = new Date();
  let year = now.getUTCFullYear();
  let month0 = now.getUTCMonth();

  for (let i = 0; i < count; i++) {
    const mm = String(month0 + 1).padStart(2, "0");
    paths.push(`${year}/${mm}`);
    const prev = new Date(Date.UTC(year, month0 - 1, 1));
    year = prev.getUTCFullYear();
    month0 = prev.getUTCMonth();
  }

  return paths;
}

function postError(message: string): void {
  const payload: ImportErrorMessage = {
    type: "IMPORT_ERROR",
    payload: { message },
  };
  self.postMessage(payload);
}

function postProgress(progress: ImportProgressMessage["payload"]): void {
  const payload: ImportProgressMessage = { type: "IMPORT_PROGRESS", payload: progress };
  self.postMessage(payload);
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

self.onmessage = async (event: MessageEvent<ImportRequestMessage>) => {
  console.log("Received message:", event.data);

  const message = event.data;

  if (message?.type !== "IMPORT_LATEST_ARCHIVE") {
    console.log("Ignoring message with invalid type:", message?.type);
    return;
  }

  const normalizedUsername = message.payload.username.trim().toLowerCase();

  if (!normalizedUsername) {
    console.error("Username is required.");
    postError("Username is required.");
    return;
  }

  const rawMonths = Number(message.payload.monthsBack);
  const monthsBack = Number.isFinite(rawMonths)
    ? Math.min(120, Math.max(1, Math.floor(rawMonths)))
    : 1;

  try {
    const paths = getArchivePathsForMonthsBack(monthsBack);
    const allGames: ChessArchiveGame[] = [];

    for (let i = 0; i < paths.length; i++) {
      const archivePath = paths[i]!;
      postProgress({ phase: "download", current: i + 1, total: paths.length });
      const archiveUrl = `https://api.chess.com/pub/player/${normalizedUsername}/games/${archivePath}`;
      console.log(`Fetching archive: ${archiveUrl}`);
      const response = await fetch(archiveUrl);

      if (response.status === 404) {
        console.log(`No archive for ${archivePath} (404), skipping.`);
        continue;
      }

      if (!response.ok) {
        console.error(`Archive request failed (status: ${response.status})`);
        throw new Error(`Archive ${archivePath} failed (${response.status}).`);
      }

      const data = (await response.json()) as { games?: unknown };
      console.log("Archive data received", {
        path: archivePath,
        hasGames: Array.isArray(data.games),
        gamesLength: Array.isArray(data.games) ? data.games.length : undefined,
      });

      if (!Array.isArray(data.games)) {
        console.error("Invalid archive response: missing games array.");
        throw new Error(`Invalid archive response for ${archivePath}: missing games array.`);
      }

      allGames.push(...(data.games as ChessArchiveGame[]));
    }

    const records = allGames
      .map((game) => toGameRecord(game, normalizedUsername))
      .filter((record): record is NonNullable<typeof record> => record !== null)
      .map(truncateGameRecordForStorage);

    console.log(`Mapped ${records.length} valid records from ${monthsBack} month(s).`);

    const movesByGame = await parseRecordsWithWorkerPool(records);
    const entries = records.map((record) => ({
      record,
      moves: movesByGame.get(record.uuid) ?? [],
    }));
    // Skipped when `buildMoveRecords` yields no rows: PGN produced no SANs (parse) or the first SAN failed to replay.
    // Mid-game replay failures still produce partial rows and are kept.
    const entriesWithMoves = entries.filter((e) => e.moves.length > 0);

    postProgress({ phase: "save" });
    await upsertGamesWithMoves(entriesWithMoves);

    const payload: ImportSuccessMessage = {
      type: "IMPORT_SUCCESS",
      payload: {
        username: normalizedUsername,
        importedCount: entriesWithMoves.length,
        monthsBack,
      },
    };

    console.log("Import successful", payload);
    self.postMessage(payload);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown import error.";
    console.error("Import error:", messageText);
    postError(messageText);
  }
};
