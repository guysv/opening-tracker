import type { ComponentChildren } from "preact";

type DesktopShellProps = {
  children: ComponentChildren;
};

/** Desktop layout: fixed sidebars + centered explorer. Unchanged chrome. */
export function DesktopShell({ children }: DesktopShellProps) {
  return <div class="layout">{children}</div>;
}
