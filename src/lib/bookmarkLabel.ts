/** Default bookmark title from the move sequence (no truncation). */
export function defaultBookmarkNameFromVia(via: string[]): string {
  if (via.length === 0) return "Start position";
  return via.join(" ");
}

export function truncateBookmarkTitle(s: string, maxLen = 48): string {
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 1))}…`;
}
