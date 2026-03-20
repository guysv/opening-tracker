declare module "pgn-parser" {
  export type PgnHeader = {
    name: string;
    value: string;
  };

  export type PgnMoveNode = {
    move?: string;
    move_number?: number;
    nags?: string[];
    ravs?: unknown[];
    comments?: unknown[];
  };

  export type ParsedPgnGame = {
    headers?: PgnHeader[];
    moves?: PgnMoveNode[];
  };

  const pgnParser: {
    parse(source: string): ParsedPgnGame[];
  };

  export default pgnParser;
}
