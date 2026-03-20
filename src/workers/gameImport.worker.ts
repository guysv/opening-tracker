import { toGameRecord, type ChessArchiveGame, upsertGames } from "../lib/gamesDb";

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

    for (const archivePath of paths) {
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
      .filter((record): record is NonNullable<typeof record> => record !== null);

    console.log(`Mapped ${records.length} valid records from ${monthsBack} month(s).`);

    await upsertGames(records);

    const payload: ImportSuccessMessage = {
      type: "IMPORT_SUCCESS",
      payload: {
        username: normalizedUsername,
        importedCount: records.length,
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
