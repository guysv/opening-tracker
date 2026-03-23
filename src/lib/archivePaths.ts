/** `YYYY/MM` paths from current UTC month going back `count` months (inclusive). */
export function getArchivePathsForMonthsBack(count: number): string[] {
  const paths: string[] = [];
  const now = new Date();
  let year = now.getUTCFullYear();
  let month0 = now.getUTCMonth();

  for (let i = 0; i < count; i++) {
    const mm = String(month0 + 1).padStart(2, "0");
    paths.push(`${year}/${mm}`);
    const prev = new Date(Date.UTC(year, month0 - 1, 1));
    year = prev.getUTCFullYear();
    month0 = prev.getUTCMonth();
  }

  return paths;
}

function parseArchivePath(path: string): { year: number; month0: number } | null {
  const m = path.match(/^(\d{4})\/(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(year) || mm < 1 || mm > 12) return null;
  return { year, month0: mm - 1 };
}

/** Months strictly before `oldestPath` (older), `count` steps; each element is `YYYY/MM`. */
export function getArchivePathsBefore(oldestPath: string, count: number): string[] {
  const parsed = parseArchivePath(oldestPath);
  if (!parsed || count <= 0) return [];
  let { year, month0 } = parsed;
  let m0 = month0 - 1;
  let y = year;
  if (m0 < 0) {
    y--;
    m0 = 11;
  }
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    paths.push(`${y}/${String(m0 + 1).padStart(2, "0")}`);
    m0--;
    if (m0 < 0) {
      y--;
      m0 = 11;
    }
  }
  return paths;
}

/**
 * How many recent month archives Sync should request.
 * - No usable last sync → 1 month (current month slice only).
 * - Otherwise → from current UTC month back through `maxArchivePath` (newest stored month), inclusive, so that month is refreshed too.
 */
export function syncMonthsToFetch(lastSyncAt: number | null, maxArchivePath: string | null): number {
  if (lastSyncAt == null || !Number.isFinite(lastSyncAt)) {
    return 1;
  }
  if (maxArchivePath == null || !String(maxArchivePath).trim()) {
    return 1;
  }
  const parsed = parseArchivePath(String(maxArchivePath).trim());
  if (!parsed) return 1;
  const now = new Date();
  const nowIdx = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const newestIdx = parsed.year * 12 + parsed.month0;
  if (newestIdx > nowIdx) return 1;
  return Math.max(1, Math.min(120, nowIdx - newestIdx + 1));
}
