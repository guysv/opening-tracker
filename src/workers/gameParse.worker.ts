import type { GameRecord, MoveRecord } from "../lib/gamesDb";
import { buildMoveRecords } from "../lib/gameMoves";

type ParseBatchMessage = {
  type: "PARSE_BATCH";
  payload: {
    requestId: number;
    games: GameRecord[];
  };
};

type ParseBatchResultMessage = {
  type: "PARSE_BATCH_RESULT";
  payload: {
    requestId: number;
    results: {
      gameId: string;
      moves: MoveRecord[];
      whiteWinKind: "trap" | "mate" | null;
      blackWinKind: "trap" | "mate" | null;
    }[];
  };
};

self.onmessage = (event: MessageEvent<ParseBatchMessage>) => {
  const message = event.data;

  if (message?.type !== "PARSE_BATCH") {
    return;
  }

  const { requestId, games } = message.payload;
  const results = games.map((g) => {
    const { moves, whiteWinKind, blackWinKind } = buildMoveRecords(g);
    return { gameId: `${g.source}:${g.externalId}`, moves, whiteWinKind, blackWinKind };
  });

  const response: ParseBatchResultMessage = {
    type: "PARSE_BATCH_RESULT",
    payload: { requestId, results },
  };

  self.postMessage(response);
};
