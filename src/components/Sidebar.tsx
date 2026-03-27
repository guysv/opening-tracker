import { useEffect, useRef, useState } from "preact/hooks";

import type { PlayerListRow } from "../lib/dbClient";
import type { EloRange } from "../lib/explorerData";
import { EloRangeSlider } from "./EloRangeSlider";
import { ImportStatusPanel, type ImportActivitySnapshot } from "./ImportStatusPanel";
import { StorageEstimatePanel } from "./StorageEstimatePanel";
import type { StoragePanelState } from "./useStorageDbState";

type SidebarProps = {
  importActivity: ImportActivitySnapshot | null;
  status: string;
  eloRange: EloRange;
  players: PlayerListRow[];
  disabledUsernames: Record<string, boolean>;
  onEloRangeChange: (range: EloRange) => void;
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

export function Sidebar({
  importActivity,
  status,
  eloRange,
  players,
  disabledUsernames,
  onEloRangeChange,
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

  return (
    <aside class="sidebar">
      <div class="player-cards-scroll">
        {!inUse &&
          players.map((p) => {
            const disabled = Boolean(disabledUsernames[p.username]);
            return (
              <div
                key={p.username}
                class={
                  disabled
                    ? "player-card player-card--disabled"
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
                  <span class="player-card-gamecount">
                    {p.gameCount} game{p.gameCount === 1 ? "" : "s"}
                  </span>
                </div>
                <div class="player-card-meta">
                  <span>{formatArchiveSpan(p.minArchivePath, p.maxArchivePath)}</span>
                </div>
                <div class="player-card-sync">
                  Last sync: {formatLastSync(p.lastSyncAt)}
                </div>

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
                <button type="submit">Import</button>
                <button type="button" class="add-player-cancel" onClick={closeAddPlayerForm}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      <button
        type="button"
        class="sidebar-clear-db"
        onClick={onClear}
        disabled={!canDownload}
      >
        Clear Database
      </button>

      {importActivity ? <ImportStatusPanel activity={importActivity} /> : null}

      <p class="sidebar-status">{status}</p>

      <EloRangeSlider value={eloRange} onChange={onEloRangeChange} />

      <StorageEstimatePanel
        state={storageState}
        downloading={downloading}
        canDownload={canDownload}
        inUse={inUse}
        onDownload={onDownloadStorage}
      />
    </aside>
  );
}
