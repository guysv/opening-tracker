/**
 * Fragment shape: `#<posHash>?via=<comma-separated SANs>`
 *
 * Everything after `#` is ours — the `?via=…` is inside the fragment,
 * not in `location.search`.
 */

export type ExplorerLocation = {
  posHash: string;
  via: string[];
};

export function parseFragment(hash: string): ExplorerLocation {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const qIdx = raw.indexOf("?");

  const posHash = qIdx === -1 ? raw : raw.slice(0, qIdx);
  const queryStr = qIdx === -1 ? "" : raw.slice(qIdx + 1);

  let via: string[] = [];
  if (queryStr) {
    const params = new URLSearchParams(queryStr);
    const viaParam = params.get("via");
    if (viaParam) {
      via = viaParam.split(",").filter(Boolean);
    }
  }

  return { posHash, via };
}

export function buildFragment(posHash: string, via: string[]): string {
  const viaPart = via.length > 0 ? `?via=${encodeURIComponent(via.join(","))}` : "";
  return `#${posHash}${viaPart}`;
}

export function navigateTo(posHash: string, via: string[]): void {
  const fragment = buildFragment(posHash, via);
  history.pushState(null, "", fragment);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
