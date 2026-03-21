import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { clearGamesStore, initDb, upsertGamesWithMoves } from "../lib/dbClient";
import type { GameRecord, MoveRecord } from "../lib/gamesDb";
import type { EloRange } from "../lib/explorerData";
import type { ImportActivitySnapshot } from "./ImportStatusPanel";
import { OpeningTracker } from "./OpeningTracker";
import { Sidebar } from "./Sidebar";

const DEFAULT_ELO_RANGE: EloRange = [0, 3500];

type WorkerResponse =
  | {
      type: "IMPORT_ENTRIES";
      payload: {
        username: string;
        entries: { record: GameRecord; moves: MoveRecord[] }[];
        monthsBack: number;
      };
    }
  | {
      type: "IMPORT_ERROR";
      payload: {
        message: string;
      };
    }
  | {
      type: "IMPORT_PROGRESS";
      payload:
        | { phase: "download"; current: number; total: number }
        | { phase: "parse"; current: number; total: number };
    };

export function App() {
  const [status, setStatus] = useState("Initializing database...");
  const [importActivity, setImportActivity] = useState<ImportActivitySnapshot | null>(
    null,
  );
  const [eloRange, setEloRange] = useState<EloRange>(DEFAULT_ELO_RANGE);
  const [expandResultBars, setExpandResultBars] = useState(false);
  const [gamesDataRevision, setGamesDataRevision] = useState(0);
  const dbReadyRef = useRef(false);
  const worker = useMemo(
    () =>
      new Worker(new URL("../workers/gameImport.worker.js", import.meta.url), {
        type: "module",
      }),
    [],
  );

  useEffect(() => {
    initDb()
      .then(() => {
        dbReadyRef.current = true;
        setStatus("Ready to import games.");
      })
      .catch((e) => {
        setStatus(`DB init failed: ${e instanceof Error ? e.message : String(e)}`);
      });
  }, []);

  useEffect(() => {
    function handleWorkerMessage(event: MessageEvent<WorkerResponse>) {
      const message = event.data;

      if (message.type === "IMPORT_ENTRIES") {
        const { username, entries, monthsBack } = message.payload;
        setImportActivity((prev) =>
          prev
            ? { ...prev, saving: true, savingStartedAt: prev.savingStartedAt ?? Date.now() }
            : null,
        );
        upsertGamesWithMoves(entries)
          .then(() => {
            setImportActivity(null);
            setGamesDataRevision((n) => n + 1);
            setStatus(
              `Imported ${entries.length} games for ${username} (last ${monthsBack} month${monthsBack === 1 ? "" : "s"}).`,
            );
          })
          .catch((e) => {
            setImportActivity(null);
            setStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
          });
        return;
      }

      if (message.type === "IMPORT_ERROR") {
        setImportActivity(null);
        setStatus(`Import failed: ${message.payload.message}`);
        return;
      }

      if (message.type === "IMPORT_PROGRESS") {
        const p = message.payload;
        setImportActivity((prev) => {
          const base: ImportActivitySnapshot = prev ?? {
            downloadCurrent: 0,
            downloadTotal: 0,
            parseCurrent: null,
            parseTotal: null,
            saving: false,
            savingStartedAt: null,
          };
          if (p.phase === "download") {
            return {
              ...base,
              downloadCurrent: p.current,
              downloadTotal: p.total,
              saving: false,
              savingStartedAt: null,
            };
          }
          if (p.phase === "parse") {
            return {
              ...base,
              downloadCurrent: base.downloadTotal,
              parseCurrent: p.current,
              parseTotal: p.total,
              saving: false,
              savingStartedAt: null,
            };
          }
          return base;
        });
      }
    }

    worker.addEventListener("message", handleWorkerMessage);

    return () => {
      worker.removeEventListener("message", handleWorkerMessage);
      worker.terminate();
    };
  }, [worker]);

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      if (!target || !(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Shift" || e.repeat) return;
      if (isEditableTarget(e.target)) return;
      setExpandResultBars(true);
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.key !== "Shift") return;
      setExpandResultBars(false);
    }

    function onWindowBlur() {
      setExpandResultBars(false);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);

  function handleImport(username: string, monthsBack: number) {
    if (!dbReadyRef.current) {
      setStatus("Database is not ready yet. Please wait.");
      return;
    }

    const normalizedUsername = username.trim().toLowerCase();

    if (!normalizedUsername) {
      setStatus("Please enter a valid chess.com username.");
      return;
    }

    const months =
      Number.isFinite(monthsBack) && monthsBack >= 1 ? Math.min(120, Math.floor(monthsBack)) : 1;

    setImportActivity({
      downloadCurrent: 0,
      downloadTotal: months,
      parseCurrent: null,
      parseTotal: null,
      saving: false,
      savingStartedAt: null,
    });
    setStatus(`Importing ${months} month${months === 1 ? "" : "s"} of archives for ${normalizedUsername}...`);
    worker.postMessage({
      type: "IMPORT_LATEST_ARCHIVE",
      payload: { username: normalizedUsername, monthsBack: months },
    });
  }

  async function handleCleanDb() {
    try {
      await clearGamesStore();
      setGamesDataRevision((n) => n + 1);
      setStatus("Database cleared.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown clear error.";
      setStatus(`Failed to clear database: ${message}`);
    }
  }

  return (
    <div class="layout">
      <Sidebar
        importActivity={importActivity}
        status={status}
        eloRange={eloRange}
        onEloRangeChange={setEloRange}
        onImport={handleImport}
        onClear={handleCleanDb}
      />
      <OpeningTracker
        eloRange={eloRange}
        expandResultBars={expandResultBars}
        gamesDataRevision={gamesDataRevision}
      />
    </div>
  );
}
