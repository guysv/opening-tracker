export type ImportActivitySnapshot = {
  downloadCurrent: number;
  downloadTotal: number;
  parseCurrent: number | null;
  parseTotal: number | null;
  saving: boolean;
};

type ImportStatusPanelProps = {
  activity: ImportActivitySnapshot;
};

export function ImportStatusPanel({ activity }: ImportStatusPanelProps) {
  const {
    downloadCurrent,
    downloadTotal,
    parseCurrent,
    parseTotal,
    saving,
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
    <div class="import-status-widget" aria-live="polite">
      <div class="import-status-widget-title">Import status</div>
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
          <span class="import-status-widget-mono">{saving ? "…" : "—"}</span>
        </li>
      </ul>
    </div>
  );
}
