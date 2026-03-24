import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { syncMonthsToFetch } from "../lib/archivePaths";
import {
  clearGamesStore,
  deletePlayer,
  getArchivesLastModifiedForUser,
  initDb,
  listPlayers,
  touchPlayerSync,
  upsertArchives,
  upsertGamesWithMoves,
  type ArchiveUpsertRow,
  type PlayerListRow,
} from "../lib/dbClient";
import type { GameRecord, MoveRecord } from "../lib/gamesDb";
import type { EloRange } from "../lib/explorerData";
import type { ImportActivitySnapshot } from "./ImportStatusPanel";
import { BookmarkSidebar } from "./BookmarkSidebar";
import { OpeningTracker } from "./OpeningTracker";
import { Sidebar } from "./Sidebar";

const DEFAULT_ELO_RANGE: EloRange = [0, 3500];

type WorkerResponse =
  | {
      type: "IMPORT_ENTRIES";
      payload: {
        username: string;
        entries: { record: GameRecord; moves: MoveRecord[] }[];
        op: "initial" | "sync" | "extend";
        archives: ArchiveUpsertRow[];
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
  const [expandResultBars, setExpandResultBars] = useState(false);
  const [gamesDataRevision, setGamesDataRevision] = useState(0);
  const [players, setPlayers] = useState<PlayerListRow[]>([]);
  const [bootDone, setBootDone] = useState(false);
  const [disabledUsernames, setDisabledUsernames] = useState<Record<string, boolean>>({});
  const [bookmarksRevision, setBookmarksRevision] = useState(0);

  const dbReadyRef = useRef(false);
  const importBusyRef = useRef(false);
  const importUsernameRef = useRef("");

  const worker = useMemo(
    () =>
      new Worker(new URL("../workers/gameImport.worker.js", import.meta.url), {
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
    initDb()
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
        setStatus(`DB init failed: ${e instanceof Error ? e.message : String(e)}`);
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
        const { username, entries, op, archives } = message.payload;
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
            if (entries.length > 0) {
              await upsertGamesWithMoves(entries);
            }
            if (op === "sync") {
              await touchPlayerSync(username, Date.now());
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
      setDisabledUsernames({});
      setGamesDataRevision((n) => n + 1);
      setStatus("Database cleared.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown clear error.";
      setStatus(`Failed to clear database: ${message}`);
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

  return (
    <div class="layout">
      <Sidebar
        importActivity={importActivity}
        status={status}
        eloRange={eloRange}
        players={players}
        disabledUsernames={disabledUsernames}
        onEloRangeChange={setEloRange}
        onImportInitial={handleImportInitial}
        onSync={handleSync}
        onExtend={handleExtend}
        onDeletePlayer={handleDeletePlayer}
        onTogglePlayer={handleToggleCard}
        onClear={handleCleanDb}
      />
      <OpeningTracker
        eloRange={eloRange}
        expandResultBars={expandResultBars}
        gamesDataRevision={gamesDataRevision}
        includeUsernames={includeUsernames}
        bookmarksRevision={bookmarksRevision}
        onBookmarkToggle={bumpBookmarks}
      />
      <BookmarkSidebar
        eloRange={eloRange}
        gamesDataRevision={gamesDataRevision}
        includeUsernames={includeUsernames}
        bookmarksRevision={bookmarksRevision}
        onBookmarksChanged={bumpBookmarks}
      />
    </div>
  );
}
