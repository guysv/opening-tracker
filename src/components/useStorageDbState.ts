import { useCallback, useEffect, useState } from "preact/hooks";
import { acquireDbOwnership, exportDb, getDbSize, isDbInUseError } from "../lib/dbClient";

export type StoragePanelState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; sizeBytes: number };

export type UseStorageDbStateOptions = {
  onAcquireSuccess?: () => void;
};

export function useStorageDbState(options: UseStorageDbStateOptions = {}) {
  const { onAcquireSuccess } = options;
  const [state, setState] = useState<StoragePanelState>({ status: "loading" });
  const [downloading, setDownloading] = useState(false);
  const [acquiring, setAcquiring] = useState(false);

  const tick = useCallback(async () => {
    try {
      const sizeBytes = await getDbSize();
      setState({ status: "ready", sizeBytes });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      setState({ status: "error", message });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    function safeTick() {
      if (!cancelled) void tick();
    }

    safeTick();
    const id = window.setInterval(safeTick, 5_000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [tick]);

  const handleAcquire = useCallback(async () => {
    setAcquiring(true);
    try {
      await acquireDbOwnership();
      await tick();
      onAcquireSuccess?.();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Acquire failed";
      setState({ status: "error", message });
    } finally {
      setAcquiring(false);
    }
  }, [tick, onAcquireSuccess]);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const bytes = await exportDb();
      const blob = new Blob([new Uint8Array(bytes)], { type: "application/x-sqlite3" });
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

  const inUse = state.status === "error" && isDbInUseError(state.message);
  const canDownload = state.status === "ready";

  return {
    state,
    downloading,
    acquiring,
    handleAcquire,
    handleDownload,
    tick,
    inUse,
    canDownload,
  };
}
