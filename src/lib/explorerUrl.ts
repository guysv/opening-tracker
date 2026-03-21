import type { ColorFilter } from "./explorerData";

/**
 * Fragment shape: `#<posHash>?via=<comma-separated SANs>&color=b`
 *
 * `color` is optional; omitted means playing as white (default board orientation).
 * Everything after `#` is ours — the query is inside the fragment, not `location.search`.
 */

export type ExplorerLocation = {
  posHash: string;
  via: string[];
  color: ColorFilter;
};

export function parseFragment(hash: string): ExplorerLocation {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const qIdx = raw.indexOf("?");

  const posHash = qIdx === -1 ? raw : raw.slice(0, qIdx);
  const queryStr = qIdx === -1 ? "" : raw.slice(qIdx + 1);

  let via: string[] = [];
  let color: ColorFilter = "w";
  if (queryStr) {
    const params = new URLSearchParams(queryStr);
    const viaParam = params.get("via");
    if (viaParam) {
      via = viaParam.split(",").filter(Boolean);
    }
    const c = params.get("color");
    if (c === "b" || c === "w") color = c;
  }

  return { posHash, via, color };
}

export function buildFragment(posHash: string, via: string[], color: ColorFilter = "w"): string {
  // Encode each SAN separately so separator commas stay literal in the URL.
  const q: string[] = [];
  if (via.length > 0) {
    q.push(`via=${via.map((s) => encodeURIComponent(s)).join(",")}`);
  }
  if (color === "b") {
    q.push("color=b");
  }
  const queryPart = q.length > 0 ? `?${q.join("&")}` : "";
  return `#${posHash}${queryPart}`;
}

export function navigateTo(
  posHash: string,
  via: string[],
  color: ColorFilter,
  opts?: { replace?: boolean },
): void {
  const fragment = buildFragment(posHash, via, color);
  if (opts?.replace) {
    history.replaceState(null, "", fragment);
  } else {
    history.pushState(null, "", fragment);
  }
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
