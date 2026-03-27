import { useEffect, useState } from "preact/hooks";

export type ImportActivitySnapshot = {
  username: string;
  op: "initial" | "sync" | "extend";
  downloadCurrent: number;
  downloadTotal: number;
  parseCurrent: number | null;
  parseTotal: number | null;
  saving: boolean;
  /** `Date.now()` when save phase began; null when not saving. */
  savingStartedAt: number | null;
};

type ImportStatusPanelProps = {
  activity: ImportActivitySnapshot;
  /** Shown inside a player card; tighter layout, title omits username when `compactTitle`. */
  embedded?: boolean;
  /** With `embedded`, use a short title (username is already in the card header). */
  compactTitle?: boolean;
};

function activityTitle(
  op: ImportActivitySnapshot["op"],
  username: string,
  compact: boolean,
): string {
  if (compact) {
    if (op === "initial") return "Importing";
    if (op === "sync") return "Syncing";
    return "Extending";
  }
  if (op === "initial") return `Importing ${username}`;
  if (op === "sync") return `Syncing ${username}`;
  return `Extending ${username}`;
}

function formatElapsedMs(ms: number): string {
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

type SavingElapsedProps = {
  saving: boolean;
  savingStartedAt: number | null;
};

function SavingElapsedLabel({ saving, savingStartedAt }: SavingElapsedProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!saving || savingStartedAt === null) {
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [saving, savingStartedAt]);

  if (!saving) {
    return <span class="import-status-widget-mono">—</span>;
  }
  if (savingStartedAt === null) {
    return <span class="import-status-widget-mono">…</span>;
  }
  return (
    <span class="import-status-widget-mono">{formatElapsedMs(now - savingStartedAt)}</span>
  );
}

export function ImportStatusPanel({
  activity,
  embedded = false,
  compactTitle = false,
}: ImportStatusPanelProps) {
  const {
    username,
    op,
    downloadCurrent,
    downloadTotal,
    parseCurrent,
    parseTotal,
    saving,
    savingStartedAt,
  } = activity;

  const downloadDone =
    downloadTotal > 0 && downloadCurrent >= downloadTotal;
  const parseDone =
    parseTotal !== null &&
    parseTotal >= 0 &&
    parseCurrent !== null &&
    parseCurrent >= parseTotal;

  const parseLabel =
    parseTotal === null
      ? "…"
      : `${parseCurrent ?? 0}/${parseTotal}`;

  return (
    <div
      class={
        embedded
          ? "import-status-widget import-status-widget--embedded"
          : "import-status-widget"
      }
      aria-live="polite"
    >
      <div class="import-status-widget-title">
        {activityTitle(op, username, embedded && compactTitle)}
      </div>
      <ul class="import-status-widget-list">
        <li
          class={
            downloadDone
              ? "import-status-widget-row import-status-widget-row--done"
              : "import-status-widget-row import-status-widget-row--active"
          }
        >
          <span>Downloading archive</span>
          <span class="import-status-widget-mono">
            {downloadTotal > 0
              ? `${downloadCurrent}/${downloadTotal}`
              : "—"}
          </span>
        </li>
        <li
          class={
            parseTotal === null
              ? "import-status-widget-row"
              : parseDone
                ? "import-status-widget-row import-status-widget-row--done"
                : "import-status-widget-row import-status-widget-row--active"
          }
        >
          <span>Parsed games</span>
          <span class="import-status-widget-mono">{parseLabel}</span>
        </li>
        <li
          class={
            saving
              ? "import-status-widget-row import-status-widget-row--active"
              : "import-status-widget-row"
          }
        >
          <span>Saving to storage</span>
          <SavingElapsedLabel saving={saving} savingStartedAt={savingStartedAt} />
        </li>
      </ul>
    </div>
  );
}
