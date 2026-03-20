import { useEffect, useMemo, useState } from "preact/hooks";

import { clearGamesStore } from "../lib/gamesDb";
import type { ImportActivitySnapshot } from "./ImportStatusPanel";
import { OpeningExplorer } from "./OpeningExplorer";
import { Sidebar } from "./Sidebar";

type WorkerResponse =
  | {
      type: "IMPORT_SUCCESS";
      payload: {
        username: string;
        importedCount: number;
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
        | { phase: "parse"; current: number; total: number }
        | { phase: "save" };
    };

export function App() {
  const [status, setStatus] = useState("Ready to import games.");
  const [importActivity, setImportActivity] = useState<ImportActivitySnapshot | null>(
    null,
  );
  const worker = useMemo(
    () =>
      new Worker(new URL("../workers/gameImport.worker.js", import.meta.url), {
        type: "module",
      }),
    [],
  );

  useEffect(() => {
    function handleWorkerMessage(event: MessageEvent<WorkerResponse>) {
      const message = event.data;

      if (message.type === "IMPORT_SUCCESS") {
        const { username, importedCount, monthsBack } = message.payload;
        setImportActivity(null);
        setStatus(
          `Imported ${importedCount} games for ${username} (last ${monthsBack} month${monthsBack === 1 ? "" : "s"}).`,
        );
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
          return {
            ...base,
            saving: true,
            savingStartedAt: base.savingStartedAt ?? Date.now(),
          };
        });
      }
    }

    worker.addEventListener("message", handleWorkerMessage);

    return () => {
      worker.removeEventListener("message", handleWorkerMessage);
      worker.terminate();
    };
  }, [worker]);

  function handleImport(username: string, monthsBack: number) {
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
      setStatus("IndexedDB games table cleared.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown clear error.";
      setStatus(`Failed to clear IndexedDB: ${message}`);
    }
  }

  return (
    <div class="layout">
      <Sidebar
        importActivity={importActivity}
        status={status}
        onImport={handleImport}
        onClear={handleCleanDb}
      />
      <OpeningExplorer />
    </div>
  );
}
