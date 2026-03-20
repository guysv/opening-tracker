declare module "pgn-parser" {
  export type PgnHeader = {
    name: string;
    value: string;
  };

  export type ParsedPgnGame = {
    headers?: PgnHeader[];
  };

  const pgnParser: {
    parse(source: string): ParsedPgnGame[];
  };

  export default pgnParser;
}
