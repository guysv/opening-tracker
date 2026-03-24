import type { AggregatedMove } from "../lib/explorerData";

export function MoveResultBar({
  move,
  maxGames,
  fullWidth,
}: {
  move: AggregatedMove;
  maxGames: number;
  fullWidth?: boolean;
}) {
  const total = move.wins + move.draws + move.losses;
  if (total === 0) return null;

  const barWidthPct = fullWidth ? 100 : (maxGames > 0 ? (move.games / maxGames) * 100 : 100);
  const mateWinPct = (move.mateWins / total) * 100;
  const trapWinPct = (move.trapWins / total) * 100;
  const plainWinPct = ((move.wins - move.trapWins - move.mateWins) / total) * 100;
  const dPct = (move.draws / total) * 100;
  const lPct = (move.losses / total) * 100;

  return (
    <div class="result-bar" style={{ width: `${barWidthPct}%` }}>
      {mateWinPct > 0 && <div class="result-bar-mate-win" style={{ width: `${mateWinPct}%` }} />}
      {plainWinPct > 0 && <div class="result-bar-win" style={{ width: `${plainWinPct}%` }} />}
      {trapWinPct > 0 && <div class="result-bar-trap-win" style={{ width: `${trapWinPct}%` }} />}
      {dPct > 0 && <div class="result-bar-draw" style={{ width: `${dPct}%` }} />}
      {lPct > 0 && <div class="result-bar-loss" style={{ width: `${lPct}%` }} />}
    </div>
  );
}
