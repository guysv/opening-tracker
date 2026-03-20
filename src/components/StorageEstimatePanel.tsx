import { useEffect, useState } from "preact/hooks";

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
  | { status: "unsupported" }
  | { status: "error"; message: string }
  | { status: "ready"; usage: number; quota: number };

export function StorageEstimatePanel() {
  const [state, setState] = useState<PanelState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (!navigator.storage?.estimate) {
        if (!cancelled) setState({ status: "unsupported" });
        return;
      }
      try {
        const { usage = 0, quota = 0 } = await navigator.storage.estimate();
        if (!cancelled) setState({ status: "ready", usage, quota });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown error";
        if (!cancelled) setState({ status: "error", message });
      }
    }

    void tick();
    const id = window.setInterval(() => void tick(), 1000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <section class="storage-widget" aria-live="polite">
      <h3 class="storage-widget-title">Storage estimate</h3>
      <p class="storage-widget-note">
        Origin usage (IndexedDB, caches, etc.) via <code>navigator.storage</code>.
      </p>
      {state.status === "loading" && (
        <p class="storage-widget-value storage-widget-muted">Measuring…</p>
      )}
      {state.status === "unsupported" && (
        <p class="storage-widget-value storage-widget-muted">Not available in this context.</p>
      )}
      {state.status === "error" && (
        <p class="storage-widget-value storage-widget-error">{state.message}</p>
      )}
      {state.status === "ready" && (
        <>
          <div class="storage-widget-rows">
            <div class="storage-widget-row">
              <span>Used</span>
              <span class="storage-widget-mono">{formatBytes(state.usage)}</span>
            </div>
            <div class="storage-widget-row">
              <span>Quota</span>
              <span class="storage-widget-mono">
                {state.quota > 0 ? formatBytes(state.quota) : "—"}
              </span>
            </div>
          </div>
          {state.quota > 0 && (
            <div
              class="storage-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(Math.min(100, (state.usage / state.quota) * 100))}
              aria-label="Share of storage quota in use"
            >
              <div
                class="storage-bar-fill"
                style={{
                  width: `${Math.min(100, (state.usage / state.quota) * 100)}%`,
                }}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}
