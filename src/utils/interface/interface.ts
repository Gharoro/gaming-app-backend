import { GameSession } from '@prisma/client';

export interface JwtUser {
  userId: string;
  username: string;
  exp: number;
  iat: number;
}

export interface ApiResponse {
  message: string;
  data?: any;
}
export interface GameSessionResponse {
  session: GameSession | null;
  timeLeftInSeconds: number | null;
  nextSessionIn: number | null;
}
export interface GameResultResponse {
  gameSessionId: string;
  winningNumber: number;
  totalPlayers: number;
  currentPlayer: { selectedNumber: number } | null;
  totalWins: number;
  winners: { user: { username: string } }[];
  nextSessionIn: number;
}
