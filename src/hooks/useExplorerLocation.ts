import { useEffect, useState } from "preact/hooks";

import { parseFragment, type ExplorerLocation } from "../lib/explorerUrl";

function currentLocation(): ExplorerLocation {
  return parseFragment(window.location.hash);
}

export function useExplorerLocation(): ExplorerLocation {
  const [loc, setLoc] = useState(currentLocation);

  useEffect(() => {
    function onHashChange() {
      setLoc(currentLocation());
    }

    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("popstate", onHashChange);

    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("popstate", onHashChange);
    };
  }, []);

  return loc;
}
