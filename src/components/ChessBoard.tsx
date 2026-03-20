const PIECE_UNICODE: Record<string, string> = {
  K: "\u265A", Q: "\u265B", R: "\u265C", B: "\u265D", N: "\u265E", P: "\u265F",
  k: "\u265A", q: "\u265B", r: "\u265C", b: "\u265D", n: "\u265E", p: "\u265F",
};

const WHITE_PIECES = new Set(["K", "Q", "R", "B", "N", "P"]);

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

function parsePlacement(fen: string): (string | null)[][] {
  const placement = fen.split(" ")[0] ?? "";
  const rows: (string | null)[][] = [];

  for (const rank of placement.split("/")) {
    const row: (string | null)[] = [];
    for (const ch of rank) {
      if (ch >= "1" && ch <= "8") {
        for (let i = 0; i < Number(ch); i++) row.push(null);
      } else {
        row.push(ch);
      }
    }
    rows.push(row);
  }

  return rows;
}

type ChessBoardProps = {
  fen: string;
  flipped?: boolean;
};

export function ChessBoard({ fen, flipped = false }: ChessBoardProps) {
  const rows = parsePlacement(fen);

  const rankOrder = flipped ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 3, 4, 5, 6, 7];
  const fileOrder = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const rankLabels = flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const fileLabels = flipped ? [...FILES].reverse() : FILES;

  return (
    <div class="board-wrap">
      <div class="board">
        {rankOrder.map((r, ri) => (
          <div class="board-row" key={ri}>
            <span class="board-rank-label">{rankLabels[ri]}</span>
            {fileOrder.map((f) => {
              const piece = rows[r]?.[f] ?? null;
              const isLight = (r + f) % 2 === 0;
              return (
                <div
                  class={`board-sq ${isLight ? "board-sq--light" : "board-sq--dark"}`}
                  key={f}
                >
                  {piece ? (
                    <span class={`board-piece ${WHITE_PIECES.has(piece) ? "board-piece--white" : "board-piece--black"}`}>
                      {PIECE_UNICODE[piece]}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
        <div class="board-file-labels">
          <span class="board-rank-label" />
          {fileLabels.map((f) => (
            <span class="board-file-label" key={f}>{f}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
