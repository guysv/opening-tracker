/** Cached engine eval from White’s perspective (UCI score normalized). */
export type StockfishEvalRecord = {
  fen_hash: string;
  kind: "cp" | "mate";
  cp: number | null;
  mate: number | null;
  depth: number | null;
  evaluated_at: number;
};

export const STOCKFISH_ANALYSIS_DEPTH = 12;

export type StockfishDisplayEval = {
  kind: "cp" | "mate";
  cp: number | null;
  mate: number | null;
  depth: number | null;
};

/** UCI scores are from the side to move; convert to White-centric centipawns / mate. */
export function uciScoreToWhiteCentipawns(
  fen: string,
  kind: "cp" | "mate",
  cp: number | null,
  mate: number | null,
): { kind: "cp" | "mate"; cp: number | null; mate: number | null } {
  const side = fen.split(/\s+/)[1];
  const blackToMove = side === "b";
  if (kind === "mate" && mate != null) {
    const m = blackToMove ? -mate : mate;
    return { kind: "mate", cp: null, mate: m };
  }
  if (kind === "cp" && cp != null) {
    const c = blackToMove ? -cp : cp;
    return { kind: "cp", cp: c, mate: null };
  }
  return { kind: "cp", cp: 0, mate: null };
}

type RawUciScore = {
  kind: "cp" | "mate";
  cp: number | null;
  mate: number | null;
  depth: number | null;
};

function parseLastInfoScore(infoLines: string[]): RawUciScore | null {
  let last: RawUciScore | null = null;
  for (const line of infoLines) {
    if (!line.startsWith("info ")) continue;
    const depthM = line.match(/\bdepth (\d+)\b/);
    const depth = depthM ? Number(depthM[1]) : null;
    const mateM = line.match(/\bscore mate (-?\d+)\b/);
    const cpM = line.match(/\bscore cp (-?\d+)\b/);
    if (mateM) {
      last = { kind: "mate", cp: null, mate: Number(mateM[1]), depth };
    } else if (cpM) {
      last = { kind: "cp", cp: Number(cpM[1]), mate: null, depth };
    }
  }
  return last;
}

function stockfishWorkerUrl(): string {
  return new URL("/stockfish/stockfish-18-lite-single.js", globalThis.location.href).href;
}

class StockfishUciEngine {
  private worker: Worker | null = null;
  private initPromise: Promise<void> | null = null;
  private lineQueue: string[] = [];
  private lineWaiters: Array<(line: string) => void> = [];
  private backlog = "";
  private hasSearched = false;
  /** True between `go` and the matching `bestmove` — `stop` only produces output while searching. */
  private searchInProgress = false;
  /** One UCI search at a time — concurrent `search()` calls share a single line queue. */
  private searchGate: Promise<void> = Promise.resolve();

  private enqueueLine(line: string) {
    if (this.lineWaiters.length) {
      this.lineWaiters.shift()!(line);
    } else {
      this.lineQueue.push(line);
    }
  }

  private pushChunk(chunk: string) {
    if (!chunk.includes("\n")) {
      const line = chunk.trim();
      if (line) this.enqueueLine(line);
      return;
    }
    this.backlog += chunk;
    const parts = this.backlog.split("\n");
    this.backlog = parts.pop() ?? "";
    for (const p of parts) {
      const line = p.trim();
      if (line) this.enqueueLine(line);
    }
  }

  /** Drop buffered lines so the next `go` only sees output for that search (avoids empty score on stray `bestmove`). */
  private clearQueuedInput() {
    this.lineQueue.length = 0;
    this.backlog = "";
  }

  private readLine(): Promise<string> {
    if (this.lineQueue.length) {
      return Promise.resolve(this.lineQueue.shift()!);
    }
    return new Promise((resolve) => {
      this.lineWaiters.push(resolve);
    });
  }

  private async readLineAbortable(signal: AbortSignal | undefined): Promise<string> {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    if (!signal) return this.readLine();
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        signal.removeEventListener("abort", onAbort);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort);
      void this.readLine().then(
        (line) => {
          signal.removeEventListener("abort", onAbort);
          resolve(line);
        },
        (err) => {
          signal.removeEventListener("abort", onAbort);
          reject(err);
        },
      );
    });
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      const w = new Worker(stockfishWorkerUrl());
      w.onmessage = (e: MessageEvent<string | unknown>) => {
        const raw = typeof e.data === "string" ? e.data : String(e.data ?? "");
        this.pushChunk(raw);
      };
      w.onerror = (err) => {
        console.error(err);
      };
      this.worker = w;
    }
    return this.worker;
  }

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const w = this.ensureWorker();
      w.postMessage("uci");
      while (true) {
        const line = await this.readLine();
        if (line === "uciok") break;
      }
      w.postMessage("isready");
      while (true) {
        const line = await this.readLine();
        if (line === "readyok") break;
      }
    })();

    return this.initPromise;
  }

  private async flushUntilBestmove() {
    while (true) {
      const line = await this.readLine();
      if (line.startsWith("bestmove")) return;
    }
  }

  /** Run search; returns raw UCI-side-to-move scores. */
  async search(fen: string, signal?: AbortSignal): Promise<RawUciScore> {
    await this.init();
    const w = this.ensureWorker();

    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = () => resolve();
    });
    const prevGate = this.searchGate;
    this.searchGate = gate;
    await prevGate;

    const run = async () => {
      try {
        if (this.hasSearched && this.searchInProgress) {
          w.postMessage("stop");
          await this.flushUntilBestmove().catch(() => {});
        }
        this.hasSearched = true;

        this.clearQueuedInput();

        w.postMessage(`position fen ${fen}`);
        w.postMessage(`go depth ${STOCKFISH_ANALYSIS_DEPTH}`);
        this.searchInProgress = true;

        const infoLines: string[] = [];
        while (true) {
          const line = signal
            ? await this.readLineAbortable(signal)
            : await this.readLine();
          const t = line.trim();
          if (t.startsWith("info ")) {
            infoLines.push(t);
          }
          if (t.startsWith("bestmove")) {
            break;
          }
        }

        const parsed = parseLastInfoScore(infoLines);
        if (!parsed) {
          throw new Error("Stockfish did not report a score");
        }
        return parsed;
      } finally {
        this.searchInProgress = false;
      }
    };

    try {
      return await run();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        w.postMessage("stop");
        await this.flushUntilBestmove().catch(() => {});
      }
      throw e;
    } finally {
      releaseGate();
    }
  }
}

let engineSingleton: StockfishUciEngine | null = null;

function getEngine(): StockfishUciEngine {
  if (!engineSingleton) engineSingleton = new StockfishUciEngine();
  return engineSingleton;
}

/**
 * Δeval (child − parent) in White-centric pawns, or a mate label when the child is mate.
 */
export function formatMoveEvalDiff(
  parent: StockfishDisplayEval,
  child: StockfishDisplayEval,
): string {
  if (parent.kind === "cp" && child.kind === "cp" && parent.cp != null && child.cp != null) {
    const d = (child.cp - parent.cp) / 100;
    const sign = d >= 0 ? "+" : "";
    return `${sign}${d.toFixed(2)}`;
  }
  if (child.kind === "mate" && child.mate != null && child.mate !== 0) {
    const k = child.mate;
    if (k > 0) return `+M${k}`;
    return `M${k}`;
  }
  if (parent.kind === "mate" && child.kind === "cp" && child.cp != null) {
    const d = child.cp / 100;
    const sign = d >= 0 ? "+" : "";
    return `${sign}${d.toFixed(2)}`;
  }
  if (parent.kind === "cp" && child.kind === "cp") {
    const d = ((child.cp ?? 0) - (parent.cp ?? 0)) / 100;
    const sign = d >= 0 ? "+" : "";
    return `${sign}${d.toFixed(2)}`;
  }
  return "—";
}

export type MoveEvalDiffAdvantage = "white" | "black" | "neutral";

const DEFAULT_BLUNDER_CP = 150;

/**
 * True if the move loses at least `thresholdCp` for the side that played it, or walks into
 * forced mate against them. Parent/child evals are White-centric (see `uciScoreToWhiteCentipawns`).
 */
export function moveIsMoverBlunder(
  parent: StockfishDisplayEval,
  child: StockfishDisplayEval,
  sideToMove: "w" | "b",
  thresholdCp: number = DEFAULT_BLUNDER_CP,
): boolean {
  if (child.kind === "mate" && child.mate != null && child.mate !== 0) {
    if (sideToMove === "w" && child.mate < 0) return true;
    if (sideToMove === "b" && child.mate > 0) return true;
  }
  if (parent.kind === "cp" && child.kind === "cp" && parent.cp != null && child.cp != null) {
    const loss =
      sideToMove === "w" ? parent.cp - child.cp : child.cp - parent.cp;
    return loss >= thresholdCp;
  }
  return false;
}

/** Whether the move improves White’s eval, Black’s, or is flat (White-centric parent/child). */
export function moveEvalDiffAdvantage(
  parent: StockfishDisplayEval,
  child: StockfishDisplayEval,
): MoveEvalDiffAdvantage {
  if (parent.kind === "cp" && child.kind === "cp" && parent.cp != null && child.cp != null) {
    const d = child.cp - parent.cp;
    if (d > 0) return "white";
    if (d < 0) return "black";
    return "neutral";
  }
  if (child.kind === "mate" && child.mate != null && child.mate !== 0) {
    if (child.mate > 0) return "white";
    return "black";
  }
  if (parent.kind === "mate" && child.kind === "cp" && child.cp != null) {
    if (child.cp > 0) return "white";
    if (child.cp < 0) return "black";
    return "neutral";
  }
  if (parent.kind === "cp" && child.kind === "cp") {
    const d = (child.cp ?? 0) - (parent.cp ?? 0);
    if (d > 0) return "white";
    if (d < 0) return "black";
    return "neutral";
  }
  return "neutral";
}

/** Analyze position with Stockfish 18 lite (single-threaded WASM); scores are White-centric. */
export async function analyzePosition(
  fen: string,
  signal?: AbortSignal,
): Promise<StockfishDisplayEval> {
  const raw = await getEngine().search(fen, signal);
  const norm = uciScoreToWhiteCentipawns(fen, raw.kind, raw.cp, raw.mate);
  return {
    kind: norm.kind,
    cp: norm.cp,
    mate: norm.mate,
    depth: raw.depth,
  };
}
