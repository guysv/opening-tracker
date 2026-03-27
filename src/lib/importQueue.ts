import type { PlayerListRow } from "./dbClient";

export type QueuedImport =
  | { kind: "initial"; username: string; monthsBack: number }
  | { kind: "sync"; player: PlayerListRow }
  | { kind: "extend"; player: PlayerListRow; extendMonths: number };
