import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  GameResultResponse,
  GameSessionResponse,
} from 'src/utils/interface/interface';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  GAME_RESULT_EVENT,
  GAME_RESULT_MESSAGE,
  PLAYER_JOINED_EVENT,
  SESSION_UPDATE_EVENT,
} from 'src/utils/constants/constants';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class GameGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly cooldownPeriod = 10;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  private readonly logger = new Logger(GameGateway.name);

  afterInit() {
    this.logger.log('WebSocket server initialized');
  }

  async handleConnection(client: Socket) {
    // Check for token, enforce authentication
    const token = client.handshake.auth.token as string;
    if (!token) {
      this.logger.error(
        `Client ${client.id} attempted to connect without a token.`,
      );
      client.disconnect();
      return;
    }

    try {
      // Validate token and attach user info to socket
      const user = this.validateToken(token);
      client.data.user = user;
    } catch (error) {
      this.logger.error(
        `Authentication failed for client ${client.id}, error: ${error.message}`,
      );
      client.disconnect();
      return;
    }

    this.logger.log(`Client connected: ${client.id}`);

    // Send current session state to the newly connected client
    const sessionState = await this.getCurrentSessionState();
    client.emit(SESSION_UPDATE_EVENT, sessionState);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  notifySessionUpdate(sessionData: GameSessionResponse) {
    this.server.emit(SESSION_UPDATE_EVENT, sessionData);
  }

  notifyPlayerJoined(body: { totalPlayers: number; lastJoinedPlayer: string }) {
    this.server.emit(PLAYER_JOINED_EVENT, body);
  }

  notifyGameResult(body: GameResultResponse) {
    this.server.emit(GAME_RESULT_EVENT, body);
  }

  @SubscribeMessage(GAME_RESULT_MESSAGE)
  async handleGetGameResult(
    @MessageBody() data: { gameId: string; userId: string },
  ) {
    const result = await this.getGameResult(data.gameId, data.userId);
    if (result.winningNumber !== -1) {
      this.notifyGameResult(result);
    }
  }

  private validateToken(token: string) {
    return this.jwtService.verify(token, {
      secret: process.env.JWT_SECRET,
    });
  }

  private async getCurrentSessionState(): Promise<GameSessionResponse> {
    // Check for active session
    const activeSession = await this.prisma.gameSession.findFirst({
      where: { isActive: true },
      orderBy: { startedAt: 'desc' },
    });

    if (activeSession) {
      const sessionEndTime =
        activeSession.startedAt.getTime() + activeSession.duration * 1000;
      const timeLeftInSeconds = Math.max(
        Math.floor((sessionEndTime - Date.now()) / 1000),
        0,
      );

      return {
        session: activeSession,
        timeLeftInSeconds,
        nextSessionIn: null,
      };
    }

    const lastSession = await this.prisma.gameSession.findFirst({
      where: { isActive: false },
      orderBy: { endedAt: 'desc' },
    });

    let nextSessionIn = 10;

    if (lastSession && lastSession.endedAt) {
      const timeSinceLastSession = Date.now() - lastSession.endedAt.getTime();
      nextSessionIn = Math.max(
        Math.ceil((10000 - timeSinceLastSession) / 1000),
        0,
      );
    }

    return {
      session: null,
      timeLeftInSeconds: null,
      nextSessionIn,
    };
  }

  private async getGameResult(
    gameId: string,
    userId: string,
  ): Promise<GameResultResponse> {
    let resultPayload: GameResultResponse = {
      gameSessionId: gameId,
      winningNumber: -1,
      totalPlayers: 0,
      currentPlayer: null,
      totalWins: 0,
      winners: [],
      nextSessionIn: -1,
    };
    // Fetch session details & winning number
    const session = await this.prisma.gameSession.findUnique({
      where: { id: gameId },
      select: { winningNumber: true, endedAt: true },
    });

    if (!session) {
      return resultPayload;
    }

    if (!session.winningNumber) {
      return resultPayload; // game not ended yet
    }

    const { winningNumber } = session;
    // Calculate stats
    const [totalPlayers, currentPlayer, totalWins, winners] = await Promise.all(
      [
        this.prisma.player.count({ where: { gameId } }),
        this.prisma.player.findFirst({
          where: { gameId, userId },
          select: { selectedNumber: true },
        }),
        this.prisma.player.count({
          where: { gameId, selectedNumber: winningNumber },
        }),
        this.prisma.player.findMany({
          where: { gameId, selectedNumber: winningNumber },
          select: {
            user: { select: { username: true } },
            selectedNumber: true,
          },
        }),
      ],
    );

    const lastSession = await this.prisma.gameSession.findFirst({
      where: { isActive: false },
      orderBy: { endedAt: 'desc' },
    });

    let nextSessionIn = this.cooldownPeriod; // Default 10s wait time

    if (lastSession && lastSession.endedAt) {
      const timeSinceLastSession = Date.now() - lastSession.endedAt.getTime();
      nextSessionIn = Math.max(
        Math.ceil((this.cooldownPeriod * 1000 - timeSinceLastSession) / 1000),
        0,
      );
    }

    const hasUpdatedStats = await this.prisma.player.findFirst({
      where: {
        gameId,
        OR: [{ isWinner: true }, { isWinner: false }],
      },
    });

    if (!hasUpdatedStats) {
      // Update win/loss stats in bulk
      await this.updatePlayerStats(gameId, winningNumber);
    }

    // Prepare and emit results
    resultPayload = {
      gameSessionId: gameId,
      winningNumber,
      totalPlayers,
      currentPlayer,
      totalWins,
      winners,
      nextSessionIn,
    };

    return resultPayload;
  }

  async updatePlayerStats(gameSessionId: string, winningNumber: number) {
    const winners = await this.prisma.player.findMany({
      where: { gameId: gameSessionId, selectedNumber: winningNumber },
      select: { userId: true },
    });

    const losers = await this.prisma.player.findMany({
      where: { gameId: gameSessionId, selectedNumber: { not: winningNumber } },
      select: { userId: true },
    });

    await this.prisma.player.updateMany({
      where: { gameId: gameSessionId, selectedNumber: winningNumber },
      data: { isWinner: true },
    });

    await this.prisma.player.updateMany({
      where: { gameId: gameSessionId, selectedNumber: { not: winningNumber } },
      data: { isWinner: false },
    });

    // Update user stats
    await this.prisma.$transaction([
      this.prisma.user.updateMany({
        where: {
          id: { in: winners.map((w) => w.userId) },
        },
        data: { wins: { increment: 1 } },
      }),
      this.prisma.user.updateMany({
        where: {
          id: { in: losers.map((l) => l.userId) },
        },
        data: { losses: { increment: 1 } },
      }),
    ]);
  }
}
