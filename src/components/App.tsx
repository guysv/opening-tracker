import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { syncMonthsToFetch } from "../lib/archivePaths";
import {
  clearGamesStore,
  deletePlayer,
  getArchivesLastModifiedForUser,
  getGamesEndTimeBounds,
  initDb,
  isDbInUseError,
  listPlayers,
  touchArchivesChecked,
  upsertArchives,
  upsertGamesWithMoves,
  type ArchiveUpsertRow,
  type ArchiveCheckedRow,
  type PlayerListRow,
} from "../lib/dbClient";
import type { GameRecord, MoveRecord } from "../lib/gamesDb";
import {
  clampDateRangeToBounds,
  toDayAlignedDateRange,
  type DateRangeSec,
  type EloRange,
} from "../lib/explorerData";
import type { ImportActivitySnapshot } from "./ImportStatusPanel";
import { BookmarkSidebar } from "./BookmarkSidebar";
import { OpeningTracker } from "./OpeningTracker";
import { Sidebar } from "./Sidebar";
import { useStorageDbState } from "./useStorageDbState";

const DEFAULT_ELO_RANGE: EloRange = [0, 3500];
const DB_RESET_ON_STARTUP_FLAG = "openingTracker:resetDbOnStartup";

type WorkerResponse =
  | {
      type: "IMPORT_ENTRIES";
      payload: {
        username: string;
        entries: { record: GameRecord; moves: MoveRecord[] }[];
        op: "initial" | "sync" | "extend";
        archives: ArchiveUpsertRow[];
        checks: ArchiveCheckedRow[];
      };
    }
  | { type: "IMPORT_ERROR"; payload: { message: string } }
  | {
      type: "IMPORT_PROGRESS";
      payload:
        | { phase: "download"; current: number; total: number }
        | { phase: "parse"; current: number; total: number };
    };

function opLabel(op: "initial" | "sync" | "extend"): string {
  if (op === "initial") return "initial import";
  if (op === "sync") return "sync";
  return "extend";
}

export function App() {
  const [status, setStatus] = useState("Initializing database...");
  const [importActivity, setImportActivity] = useState<ImportActivitySnapshot | null>(null);
  const [eloRange, setEloRange] = useState<EloRange>(DEFAULT_ELO_RANGE);
  const [dateBoundsSec, setDateBoundsSec] = useState<DateRangeSec | null>(null);
  const [dateRangeSec, setDateRangeSec] = useState<DateRangeSec | null>(null);
  const prevDateBoundsRef = useRef<DateRangeSec | null>(null);
  const [expandResultBars, setExpandResultBars] = useState(false);
  const [gamesDataRevision, setGamesDataRevision] = useState(0);
  const [players, setPlayers] = useState<PlayerListRow[]>([]);
  const [bootDone, setBootDone] = useState(false);
  const [disabledUsernames, setDisabledUsernames] = useState<Record<string, boolean>>({});
  const [bookmarksRevision, setBookmarksRevision] = useState(0);
  const [bookmarkPreview, setBookmarkPreview] = useState<{
    fen: string;
    posHash: string;
    sideToMove: "w" | "b";
  } | null>(null);

  const dbReadyRef = useRef(false);
  const importBusyRef = useRef(false);
  const importUsernameRef = useRef("");

  const worker = useMemo(
    () =>
      new Worker(new URL("./workers/gameImport.worker.js", import.meta.url), {
        type: "module",
      }),
    [],
  );

  const refreshPlayers = useCallback(async () => {
    if (!dbReadyRef.current) return;
    try {
      const rows = await listPlayers();
      setPlayers(rows);
    } catch {
      /* ignore list errors in background refresh */
    }
  }, []);

  useEffect(() => {
    const resetOnInit = localStorage.getItem(DB_RESET_ON_STARTUP_FLAG) === "1";
    if (resetOnInit) {
      localStorage.removeItem(DB_RESET_ON_STARTUP_FLAG);
    }
    initDb(resetOnInit)
      .then(() => {
        dbReadyRef.current = true;
        return listPlayers();
      })
      .then((rows) => {
        setPlayers(rows);
        setBootDone(true);
        setStatus("Ready to import games.");
      })
      .catch((e) => {
        if (isDbInUseError(e)) {
          setStatus(
            "Database is open in another tab. Use \"Acquire database\" at the top of the sidebar.",
          );
        } else {
          setStatus(`DB init failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
  }, []);

  useEffect(() => {
    if (!bootDone) return;
    refreshPlayers();
  }, [bootDone, gamesDataRevision, refreshPlayers]);

  useEffect(() => {
    function handleWorkerMessage(event: MessageEvent<WorkerResponse>) {
      const message = event.data;

      if (message.type === "IMPORT_ENTRIES") {
        const { username, entries, op, archives, checks } = message.payload;
        setImportActivity((prev) =>
          prev
            ? { ...prev, saving: true, savingStartedAt: prev.savingStartedAt ?? Date.now() }
            : null,
        );

        const save = async () => {
          try {
            if (archives.length > 0) {
              await upsertArchives(archives);
            }
            if (checks.length > 0) {
              await touchArchivesChecked(checks);
            }
            if (entries.length > 0) {
              await upsertGamesWithMoves(entries);
            }
            setImportActivity(null);
            importBusyRef.current = false;
            setGamesDataRevision((n) => n + 1);
            setDisabledUsernames((d) => {
              if (!d[username]) return d;
              const next = { ...d };
              delete next[username];
              return next;
            });
            let part: string;
            if (entries.length > 0) {
              part = `saved ${entries.length} game${entries.length === 1 ? "" : "s"}`;
            } else if (archives.length > 0) {
              part = `updated ${archives.length} downloaded archive${archives.length === 1 ? "" : "s"}`;
            } else {
              part = "nothing to save";
            }
            setStatus(`${username}: ${opLabel(op)} complete (${part}).`);
          } catch (e) {
            setImportActivity(null);
            importBusyRef.current = false;
            setStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        };

        void save();
        return;
      }

      if (message.type === "IMPORT_ERROR") {
        setImportActivity(null);
        importBusyRef.current = false;
        setStatus(`Import failed: ${message.payload.message}`);
        return;
      }

      if (message.type === "IMPORT_PROGRESS") {
        const p = message.payload;
        setImportActivity((prev) => {
          const base: ImportActivitySnapshot = prev ?? {
            username: importUsernameRef.current,
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

  function startImportActivity(username: string, downloadTotal: number) {
    importUsernameRef.current = username;
    setImportActivity({
      username,
      downloadCurrent: 0,
      downloadTotal,
      parseCurrent: null,
      parseTotal: null,
      saving: false,
      savingStartedAt: null,
    });
  }

  function handleImportInitial(username: string, monthsBack: number) {
    if (!dbReadyRef.current) {
      setStatus("Database is not ready yet. Please wait.");
      return;
    }
    if (importBusyRef.current) {
      setStatus("Another import is already running.");
      return;
    }

    const normalizedUsername = username.trim().toLowerCase();
    if (!normalizedUsername) {
      setStatus("Please enter a valid chess.com username.");
      return;
    }

    const months =
      Number.isFinite(monthsBack) && monthsBack >= 1 ? Math.min(120, Math.floor(monthsBack)) : 1;

    importBusyRef.current = true;
    startImportActivity(normalizedUsername, months);
    setStatus(`Importing ${months} month${months === 1 ? "" : "s"} for ${normalizedUsername}...`);
    void getArchivesLastModifiedForUser(normalizedUsername)
      .then((archiveLastModifiedByPath) => {
        worker.postMessage({
          type: "IMPORT_INITIAL",
          payload: { username: normalizedUsername, monthsBack: months, archiveLastModifiedByPath },
        });
      })
      .catch((e) => {
        importBusyRef.current = false;
        setImportActivity(null);
        setStatus(`Failed to read archive metadata: ${e instanceof Error ? e.message : String(e)}`);
      });
  }

  function handleSync(player: PlayerListRow) {
    if (!dbReadyRef.current || importBusyRef.current) {
      if (importBusyRef.current) setStatus("Another import is already running.");
      return;
    }
    importBusyRef.current = true;
    const total = syncMonthsToFetch(player.lastSyncAt, player.maxArchivePath);
    startImportActivity(player.username, total);
    setStatus(`Syncing ${player.username}...`);
    void getArchivesLastModifiedForUser(player.username)
      .then((archiveLastModifiedByPath) => {
        worker.postMessage({
          type: "IMPORT_SYNC",
          payload: {
            username: player.username,
            lastSyncAt: player.lastSyncAt,
            maxArchivePath: player.maxArchivePath,
            archiveLastModifiedByPath,
          },
        });
      })
      .catch((e) => {
        importBusyRef.current = false;
        setImportActivity(null);
        setStatus(`Failed to read archive metadata: ${e instanceof Error ? e.message : String(e)}`);
      });
  }

  function handleExtend(player: PlayerListRow, extendMonths: number) {
    if (!dbReadyRef.current || importBusyRef.current) {
      if (importBusyRef.current) setStatus("Another import is already running.");
      return;
    }
    const oldest = player.minArchivePath ?? player.minGameEndMonth;
    if (!oldest) {
      setStatus(`No archive or game date to extend from for ${player.username}.`);
      return;
    }
    const em = Math.min(120, Math.max(1, Math.floor(extendMonths)));
    importBusyRef.current = true;
    startImportActivity(player.username, em);
    setStatus(`Extending history for ${player.username}...`);
    void getArchivesLastModifiedForUser(player.username)
      .then((archiveLastModifiedByPath) => {
        worker.postMessage({
          type: "IMPORT_EXTEND",
          payload: {
            username: player.username,
            oldestPath: oldest,
            extendMonths: em,
            archiveLastModifiedByPath,
          },
        });
      })
      .catch((e) => {
        importBusyRef.current = false;
        setImportActivity(null);
        setStatus(`Failed to read archive metadata: ${e instanceof Error ? e.message : String(e)}`);
      });
  }

  async function handleDeletePlayer(username: string) {
    if (!dbReadyRef.current) return;
    const u = username.trim().toLowerCase();
    if (!window.confirm(`Remove all data for ${u} from this database?`)) return;
    try {
      await deletePlayer(u);
      setDisabledUsernames((d) => {
        const next = { ...d };
        delete next[u];
        return next;
      });
      setGamesDataRevision((n) => n + 1);
      setStatus(`Removed player ${u}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      setStatus(`Delete failed: ${message}`);
    }
  }

  function handleToggleCard(username: string) {
    const u = username.trim().toLowerCase();
    setDisabledUsernames((d) => ({ ...d, [u]: !d[u] }));
  }

  async function handleCleanDb() {
    try {
      await clearGamesStore();
      localStorage.removeItem(DB_RESET_ON_STARTUP_FLAG);
      location.reload();
    } catch (error) {
      localStorage.setItem(DB_RESET_ON_STARTUP_FLAG, "1");
      const message = error instanceof Error ? error.message : "Unknown clear error.";
      setStatus(`Failed to clear immediately, will clear on restart: ${message}`);
      location.reload();
    }
  }

  const includeUsernames = useMemo(() => {
    if (!bootDone) return undefined;
    if (players.length === 0) return undefined;
    return players.map((p) => p.username).filter((u) => !disabledUsernames[u]);
  }, [bootDone, players, disabledUsernames]);

  const bumpBookmarks = useCallback(() => {
    setBookmarksRevision((n) => n + 1);
  }, []);

  const handleDbAcquired = useCallback(() => {
    dbReadyRef.current = true;
    setBootDone(true);
    setStatus("Ready to import games.");
    void listPlayers().then((rows) => setPlayers(rows));
  }, []);

  const storageDb = useStorageDbState({ onAcquireSuccess: handleDbAcquired });

  useEffect(() => {
    if (!bootDone) return;
    if (storageDb.inUse) {
      setDateBoundsSec(null);
      setDateRangeSec(null);
      prevDateBoundsRef.current = null;
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const raw = await getGamesEndTimeBounds();
        if (cancelled) return;
        if (raw.minSec == null || raw.maxSec == null) {
          setDateBoundsSec(null);
          setDateRangeSec(null);
          prevDateBoundsRef.current = null;
          return;
        }
        const bounds = toDayAlignedDateRange(raw.minSec, raw.maxSec);
        setDateBoundsSec(bounds);
        setDateRangeSec((prev) => {
          const oldB = prevDateBoundsRef.current;
          prevDateBoundsRef.current = bounds;
          if (oldB == null || prev == null) return bounds;
          const wasFull = prev[0] === oldB[0] && prev[1] === oldB[1];
          if (wasFull) return bounds;
          return clampDateRangeToBounds(prev, bounds);
        });
      } catch {
        if (!cancelled) setDateBoundsSec(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bootDone, gamesDataRevision, storageDb.inUse]);

  return (
    <div class="layout">
      <Sidebar
        importActivity={importActivity}
        status={status}
        players={players}
        disabledUsernames={disabledUsernames}
        onImportInitial={handleImportInitial}
        onSync={handleSync}
        onExtend={handleExtend}
        onDeletePlayer={handleDeletePlayer}
        onTogglePlayer={handleToggleCard}
        onClear={handleCleanDb}
        storageState={storageDb.state}
        downloading={storageDb.downloading}
        acquiring={storageDb.acquiring}
        onAcquireStorage={() => void storageDb.handleAcquire()}
        onDownloadStorage={() => void storageDb.handleDownload()}
        inUse={storageDb.inUse}
        canDownload={storageDb.canDownload}
      />
      <OpeningTracker
        dateBoundsSec={dateBoundsSec}
        dateRangeSec={dateRangeSec}
        onDateRangeChange={setDateRangeSec}
        eloRange={eloRange}
        onEloRangeChange={setEloRange}
        expandResultBars={expandResultBars}
        gamesDataRevision={gamesDataRevision}
        includeUsernames={includeUsernames}
        bookmarksRevision={bookmarksRevision}
        onBookmarkToggle={bumpBookmarks}
        bookmarkPreview={bookmarkPreview}
        dbInUse={storageDb.inUse}
      />
      <BookmarkSidebar
        dateBoundsSec={dateBoundsSec}
        dateRangeSec={dateRangeSec}
        eloRange={eloRange}
        gamesDataRevision={gamesDataRevision}
        includeUsernames={includeUsernames}
        bookmarksRevision={bookmarksRevision}
        onBookmarksChanged={bumpBookmarks}
        onPreviewChange={setBookmarkPreview}
        dbInUse={storageDb.inUse}
      />
    </div>
  );
}
