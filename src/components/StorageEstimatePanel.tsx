import { useCallback, useEffect, useState } from "preact/hooks";
import { exportDb, getDbSize } from "../lib/dbClient";

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

type PanelState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; sizeBytes: number };

export function StorageEstimatePanel() {
  const [state, setState] = useState<PanelState>({ status: "loading" });
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const sizeBytes = await getDbSize();
        if (!cancelled) setState({ status: "ready", sizeBytes });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown error";
        if (!cancelled) setState({ status: "error", message });
      }
    }

    void tick();
    const id = window.setInterval(() => void tick(), 5_000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const bytes = await exportDb();
      const blob = new Blob([bytes], { type: "application/x-sqlite3" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "opening-tracker.db";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }, []);

  return (
    <section class="storage-widget" aria-live="polite">
      <h3 class="storage-widget-title">Database size</h3>
      <p class="storage-widget-note">SQLite on OPFS</p>
      {state.status === "loading" && (
        <p class="storage-widget-value storage-widget-muted">Measuring…</p>
      )}
      {state.status === "error" && (
        <p class="storage-widget-value storage-widget-error">{state.message}</p>
      )}
      {state.status === "ready" && (
        <div class="storage-widget-rows">
          <div class="storage-widget-row">
            <span>Size</span>
            <span class="storage-widget-mono">{formatBytes(state.sizeBytes)}</span>
          </div>
          <button
            class="storage-widget-download"
            onClick={handleDownload}
            disabled={downloading}
          >
            {downloading ? "Exporting…" : "Download .db"}
          </button>
        </div>
      )}
    </section>
  );
}
