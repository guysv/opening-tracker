declare module "bitboard-chess" {
  export default class BitboardChess {
    constructor();
    loadFromFEN(fen: string): void;
    toFEN(): string;
    getZobristKey(): bigint;
    makeMoveSAN(san: string): boolean;
    reset(): void;
  }
}
