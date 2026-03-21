declare module "bitboard-chess" {
  export default class BitboardChess {
    constructor();
    loadFromFEN(fen: string): void;
    toFEN(): string;
    getZobristKey(): bigint;
    makeMoveSAN(san: string): boolean;
    resolveSAN(san: string): { from: number; to: number } | null;
    getPosition(): {
      sideToMove: "w" | "b";
      zobrist: bigint;
      whitePawns: bigint;
      blackPawns: bigint;
      whiteKnights: bigint;
      whiteBishops: bigint;
      whiteRooks: bigint;
      whiteQueens: bigint;
      whiteKing: bigint;
      blackKnights: bigint;
      blackBishops: bigint;
      blackRooks: bigint;
      blackQueens: bigint;
      blackKing: bigint;
      whiteOccupancy: bigint;
      blackOccupancy: bigint;
      fullOccupancy: bigint;
    };
    reset(): void;
  }
}
