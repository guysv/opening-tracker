import type { StoragePanelState } from "./useStorageDbState";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  const n = bytes / k ** i;
  const digits = i === 0 ? 0 : n >= 100 ? 0 : 1;
  return `${n.toFixed(digits)} ${sizes[i]}`;
}

export type StorageEstimatePanelProps = {
  state: StoragePanelState;
  downloading: boolean;
  canDownload: boolean;
  inUse: boolean;
  onDownload: () => void;
};

export function StorageEstimatePanel({
  state,
  downloading,
  canDownload,
  inUse,
  onDownload,
}: StorageEstimatePanelProps) {
  return (
    <section class="storage-widget" aria-live="polite">
      <h3 class="storage-widget-title">Database info</h3>
      {state.status === "loading" && (
        <p class="storage-widget-value storage-widget-muted">Measuring…</p>
      )}
      {state.status === "error" && !inUse && (
        <p class="storage-widget-value storage-widget-error">{state.message}</p>
      )}
      {inUse && (
        <p class="storage-widget-value storage-widget-muted">
          Database is open in another tab.
        </p>
      )}
      <div class="storage-widget-rows">
        {state.status === "ready" ? (
          <div class="storage-widget-row">
            <span>Size</span>
            <span class="storage-widget-mono">{formatBytes(state.sizeBytes)}</span>
          </div>
        ) : (
          <div class="storage-widget-row">
            <span>Size</span>
            <span class="storage-widget-mono">—</span>
          </div>
        )}
        <button
          class="storage-widget-download"
          type="button"
          onClick={onDownload}
          disabled={downloading || !canDownload}
        >
          {downloading ? "Exporting…" : "Download .db"}
        </button>
      </div>
    </section>
  );
}
