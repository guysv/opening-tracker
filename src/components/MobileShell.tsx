import type { ComponentChild } from "preact";
import { useEffect, useState } from "preact/hooks";

export type MobileTabId = "db" | "explorer" | "bookmarks";

/** Top-level query key (alongside e.g. `touchShell=1`). Explorer position stays in `#hash`. */
export const MOBILE_TAB_QUERY_KEY = "tab";

function tabFromSearch(search: string, defaultWhenOmitted: MobileTabId): MobileTabId {
  try {
    const raw = new URLSearchParams(search).get(MOBILE_TAB_QUERY_KEY)?.toLowerCase();
    if (raw === "db" || raw === "explorer" || raw === "bookmarks") return raw;
  } catch {
    /* ignore */
  }
  return defaultWhenOmitted;
}

function syncTabQueryParam(tab: MobileTabId, defaultWhenOmitted: MobileTabId) {
  try {
    const u = new URL(window.location.href);
    if (tab === defaultWhenOmitted) u.searchParams.delete(MOBILE_TAB_QUERY_KEY);
    else u.searchParams.set(MOBILE_TAB_QUERY_KEY, tab);
    const q = u.searchParams.toString();
    const qs = q ? `?${q}` : "";
    history.replaceState(null, "", `${u.pathname}${qs}${u.hash}`);
  } catch {
    /* ignore */
  }
}

type MobileShellProps = {
  /** When `?tab=` is absent, which tab the URL implies (e.g. DB until at least one player exists). */
  defaultTabWhenOmitted: MobileTabId;
  /** Desktop left column: import, players, storage (`Sidebar`). */
  sideView: ComponentChild;
  /** Main explorer: board + moves (`OpeningTracker`). */
  explorer: ComponentChild;
  /** Desktop right bookmark strip (`BookmarkSidebar`). */
  bookmarks: ComponentChild;
};

const TABS: { id: MobileTabId; label: string }[] = [
  { id: "db", label: "DB" },
  { id: "explorer", label: "Explorer" },
  { id: "bookmarks", label: "Bookmarks" },
];

/**
 * Touch shell: one desktop region per tab.
 * DB → side panel · Explorer → board + moves · Bookmarks → bookmark list.
 */
export function MobileShell({
  defaultTabWhenOmitted,
  sideView,
  explorer,
  bookmarks,
}: MobileShellProps) {
  const [tab, setTab] = useState<MobileTabId>(() =>
    typeof window === "undefined"
      ? defaultTabWhenOmitted
      : tabFromSearch(window.location.search, defaultTabWhenOmitted),
  );

  useEffect(() => {
    function onPopState() {
      setTab(tabFromSearch(window.location.search, defaultTabWhenOmitted));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [defaultTabWhenOmitted]);

  /** When the URL omits `?tab=`, follow the app default (e.g. DB with no players). */
  useEffect(() => {
    try {
      const raw = new URLSearchParams(window.location.search).get(MOBILE_TAB_QUERY_KEY);
      if (raw != null) return;
    } catch {
      return;
    }
    setTab(defaultTabWhenOmitted);
    syncTabQueryParam(defaultTabWhenOmitted, defaultTabWhenOmitted);
  }, [defaultTabWhenOmitted]);

  /** Drop invalid `?tab=` values so the URL matches what we render. */
  useEffect(() => {
    try {
      const raw = new URLSearchParams(window.location.search).get(MOBILE_TAB_QUERY_KEY);
      if (raw == null) return;
      const lower = raw.toLowerCase();
      if (lower === "db" || lower === "explorer" || lower === "bookmarks") return;
      syncTabQueryParam(
        tabFromSearch(window.location.search, defaultTabWhenOmitted),
        defaultTabWhenOmitted,
      );
    } catch {
      /* ignore */
    }
  }, [defaultTabWhenOmitted]);

  function selectTab(next: MobileTabId) {
    setTab(next);
    syncTabQueryParam(next, defaultTabWhenOmitted);
  }

  return (
    <div class="layout-mobile">
      <div class="layout-mobile-tabs" role="tablist" aria-label="App sections">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`layout-mobile-tab-${id}`}
            aria-controls={`layout-mobile-panel-${id}`}
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            class={`layout-mobile-tab ${tab === id ? "layout-mobile-tab--active" : ""}`}
            onClick={() => selectTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div class="layout-mobile-panels">
        <section
          id="layout-mobile-panel-db"
          role="tabpanel"
          aria-labelledby="layout-mobile-tab-db"
          hidden={tab !== "db"}
          class="layout-mobile-panel"
        >
          {sideView}
        </section>
        <section
          id="layout-mobile-panel-explorer"
          role="tabpanel"
          aria-labelledby="layout-mobile-tab-explorer"
          hidden={tab !== "explorer"}
          class="layout-mobile-panel"
        >
          {explorer}
        </section>
        <section
          id="layout-mobile-panel-bookmarks"
          role="tabpanel"
          aria-labelledby="layout-mobile-tab-bookmarks"
          hidden={tab !== "bookmarks"}
          class="layout-mobile-panel"
        >
          {bookmarks}
        </section>
      </div>
    </div>
  );
}
