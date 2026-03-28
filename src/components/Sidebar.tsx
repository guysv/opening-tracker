import { useEffect, useRef, useState } from "preact/hooks";

import type { PlayerListRow } from "../lib/dbClient";
import type { QueuedImport } from "../lib/importQueue";
import { ImportStatusPanel, type ImportActivitySnapshot } from "./ImportStatusPanel";
import { StorageEstimatePanel } from "./StorageEstimatePanel";
import type { StoragePanelState } from "./useStorageDbState";

type SidebarProps = {
  importActivity: ImportActivitySnapshot | null;
  /** FIFO jobs waiting while another import runs (shown as preview cards) */
  importQueue: QueuedImport[];
  status: string;
  players: PlayerListRow[];
  disabledUsernames: Record<string, boolean>;
  onImportInitial: (username: string, monthsBack: number) => void;
  onSync: (player: PlayerListRow) => void;
  onExtend: (player: PlayerListRow, extendMonths: number) => void;
  onDeletePlayer: (username: string) => void;
  onTogglePlayer: (username: string) => void;
  onClear: () => void;
  storageState: StoragePanelState;
  downloading: boolean;
  acquiring: boolean;
  onAcquireStorage: () => void;
  onDownloadStorage: () => void;
  inUse: boolean;
  canDownload: boolean;
};

function formatArchiveSpan(minPath: string | null, maxPath: string | null): string {
  if (minPath && maxPath) return minPath === maxPath ? minPath : `${minPath}–${maxPath}`;
  if (minPath) return `${minPath}–`;
  if (maxPath) return maxPath;
  return "—";
}

function formatLastSync(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  try {
    return new Date(ms).toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return "—";
  }
}

function queuedImportSummary(job: QueuedImport): string {
  if (job.kind === "initial") {
    return `Import · ${job.monthsBack} month${job.monthsBack === 1 ? "" : "s"} back`;
  }
  if (job.kind === "sync") {
    return "Sync new archives";
  }
  return `Extend · ${job.extendMonths} month${job.extendMonths === 1 ? "" : "s"} older`;
}

function queuedImportUsername(job: QueuedImport): string {
  return job.kind === "initial" ? job.username : job.player.username;
}

export function Sidebar({
  importActivity,
  importQueue,
  status,
  players,
  disabledUsernames,
  onImportInitial,
  onSync,
  onExtend,
  onDeletePlayer,
  onTogglePlayer,
  onClear,
  storageState,
  downloading,
  acquiring,
  onAcquireStorage,
  onDownloadStorage,
  inUse,
  canDownload,
}: SidebarProps) {
  const [addPlayerOpen, setAddPlayerOpen] = useState(false);
  const [addUsername, setAddUsername] = useState("");
  const [addMonthsBack, setAddMonthsBack] = useState("3");
  const addUsernameRef = useRef<HTMLInputElement | null>(null);

  const [extendOpenFor, setExtendOpenFor] = useState<string | null>(null);
  const [extendMonthsDraft, setExtendMonthsDraft] = useState("3");
  const extendInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (extendOpenFor == null) return;
    queueMicrotask(() => {
      const el = extendInputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    });
  }, [extendOpenFor]);

  useEffect(() => {
    if (!addPlayerOpen) return;
    queueMicrotask(() => addUsernameRef.current?.focus());
  }, [addPlayerOpen]);

  function closeAddPlayerForm() {
    setAddPlayerOpen(false);
    setAddUsername("");
    setAddMonthsBack("3");
  }

  function handleAddSubmit(event: SubmitEvent) {
    event.preventDefault();
    const username = addUsername.trim();
    if (!username) return;
    const raw = Number(addMonthsBack);
    const monthsBack =
      Number.isFinite(raw) && raw >= 1 ? Math.min(120, Math.floor(raw)) : 3;
    closeAddPlayerForm();
    onImportInitial(username, monthsBack);
  }

  function openExtendMode(username: string) {
    setExtendOpenFor(username);
    setExtendMonthsDraft("3");
  }

  function closeExtendMode() {
    setExtendOpenFor(null);
  }

  function parseExtendMonths(): number {
    const raw = Number(extendMonthsDraft);
    return Number.isFinite(raw) && raw >= 1 ? Math.min(120, Math.floor(raw)) : 3;
  }

  function confirmExtend(player: PlayerListRow) {
    const n = parseExtendMonths();
    closeExtendMode();
    onExtend(player, n);
  }

  const importForNewPlayer =
    importActivity != null &&
    !players.some((p) => p.username === importActivity.username);

  return (
    <aside class="sidebar">
      <div class="player-cards-scroll">
        {!inUse &&
          players.map((p) => {
            const disabled = Boolean(disabledUsernames[p.username]);
            const importHere = importActivity?.username === p.username;
            return (
              <div
                key={p.username}
                class={
                  disabled
                    ? importHere
                      ? "player-card player-card--disabled player-card--import-active"
                      : "player-card player-card--disabled"
                    : importHere
                      ? "player-card player-card--enabled player-card--import-active"
                      : "player-card player-card--enabled"
                }
                onClick={() => onTogglePlayer(p.username)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onTogglePlayer(p.username);
                  }
                }}
              >
                <div class="player-card-top">
                  <span class="player-card-name">{p.username}</span>
                </div>
                <div class="player-card-meta">
                  <span>{formatArchiveSpan(p.minArchivePath, p.maxArchivePath)}</span>
                  <span class="player-card-gamecount">
                    {p.gameCount} game{p.gameCount === 1 ? "" : "s"}
                  </span>
                </div>
                <div class="player-card-sync">
                  Last sync: {formatLastSync(p.lastSyncAt)}
                </div>

                {importHere && importActivity ? (
                  <div
                    class="player-card-import-status"
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    <ImportStatusPanel
                      activity={importActivity}
                      embedded
                      compactTitle
                    />
                  </div>
                ) : null}

                <div
                  class="player-card-actions"
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <div class="player-card-buttons">
                    {extendOpenFor === p.username ? (
                      <div class="player-card-extend-inline">
                        <input
                          ref={extendInputRef}
                          class="player-card-extend-input"
                          type="number"
                          min={1}
                          max={120}
                          value={extendMonthsDraft}
                          onInput={(e) =>
                            setExtendMonthsDraft(
                              (e.currentTarget as HTMLInputElement).value
                            )
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.preventDefault();
                              closeExtendMode();
                            }
                            if (e.key === "Enter") {
                              e.preventDefault();
                              confirmExtend(p);
                            }
                          }}
                        />
                        <button
                          type="button"
                          class="player-card-btn player-card-btn--secondary player-card-btn--inline"
                          onClick={() => confirmExtend(p)}
                        >
                          Go
                        </button>
                        <button
                          type="button"
                          class="player-card-btn player-card-btn--secondary player-card-btn--inline"
                          aria-label="Cancel extend"
                          onClick={closeExtendMode}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          class="player-card-btn player-card-btn--secondary"
                          onClick={() => onSync(p)}
                        >
                          Sync
                        </button>
                        <button
                          type="button"
                          class="player-card-btn player-card-btn--secondary"
                          onClick={() => openExtendMode(p.username)}
                        >
                          Extend
                        </button>
                        <button
                          type="button"
                          class="player-card-btn player-card-btn--danger"
                          onClick={() => onDeletePlayer(p.username)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

        {!inUse && importForNewPlayer && importActivity ? (
          <div
            class="player-card player-card--import-pending"
            onClick={(e) => {
              e.stopPropagation();
            }}
            role="status"
          >
            <ImportStatusPanel activity={importActivity} embedded />
          </div>
        ) : null}

        {!inUse &&
          importQueue.map((job, i) => (
            <div
              key={`q-${i}-${job.kind}-${queuedImportUsername(job)}`}
              class="player-card player-card--queued"
              role="status"
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <div class="player-card-top">
                <span class="player-card-name">{queuedImportUsername(job)}</span>
                <span class="player-card-queued-badge">Queued</span>
              </div>
              <div class="player-card-meta player-card-meta--queued">
                {queuedImportSummary(job)}
              </div>
              <div class="player-card-queue-position">
                {i === 0 ? "Next in queue" : `After ${i} job${i === 1 ? "" : "s"}`}
              </div>
            </div>
          ))}

        <div
          class={addPlayerOpen ? "add-player-card add-player-card--open" : "add-player-card"}
        >
          {!addPlayerOpen ? (
            inUse ? (
              <button
                type="button"
                class="add-player-card-trigger add-player-card-trigger--acquire"
                aria-label={
                  acquiring ? "Acquiring database" : "Acquire database for use in this tab"
                }
                onClick={onAcquireStorage}
                disabled={acquiring}
              >
                <span class="add-player-card-acquire-title">
                  {acquiring ? "Acquiring…" : "Acquire database"}
                </span>
                <span class="add-player-card-acquire-sub">Another tab has the file open</span>
              </button>
            ) : (
              <button
                type="button"
                class="add-player-card-trigger"
                aria-label="Add player"
                onClick={() => setAddPlayerOpen(true)}
              >
                <span class="add-player-card-plus" aria-hidden>
                  +
                </span>
              </button>
            )
          ) : (
            <form
              class="import-form import-form--add import-form--in-card"
              onSubmit={handleAddSubmit}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  closeAddPlayerForm();
                }
              }}
            >
              <div class="add-player-form-title">Add player</div>
              <div class="add-player-form-row">
                <input
                  ref={addUsernameRef}
                  name="username"
                  type="text"
                  placeholder="chess.com username"
                  aria-label="chess.com username"
                  required
                  value={addUsername}
                  onInput={(e) => setAddUsername((e.currentTarget as HTMLInputElement).value)}
                />
              </div>
              <div class="add-player-form-row add-player-form-row--controls">
                <div
                  class="add-player-months-group"
                  title="How many past calendar months of games to fetch (1–120)."
                >
                  <label class="add-player-months-label" for="add-player-months">
                    Months back
                  </label>
                  <input
                    id="add-player-months"
                    name="monthsBack"
                    type="number"
                    min={1}
                    max={120}
                    aria-label="Months back — how many past months of games to import"
                    required
                    value={addMonthsBack}
                    onInput={(e) => setAddMonthsBack((e.currentTarget as HTMLInputElement).value)}
                  />
                </div>
                <button type="submit" aria-label="Import" title="Import">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="add-player-cancel"
                  aria-label="Cancel"
                  title="Cancel"
                  onClick={closeAddPlayerForm}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      <StorageEstimatePanel
        state={storageState}
        downloading={downloading}
        canDownload={canDownload}
        inUse={inUse}
        onDownload={onDownloadStorage}
        onClear={onClear}
        canClear={canDownload}
        status={status}
      />
    </aside>
  );
}
