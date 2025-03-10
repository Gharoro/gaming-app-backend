import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from 'src/prisma/prisma.service';
import { ApiResponse, GameResultResponse } from 'src/utils/interface/interface';
import { GameGateway } from './game.gateway';

@Injectable()
export class GameService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GameService.name);
  private isRunning = false;
  private readonly sessionDuration = 30;
  private readonly cooldownPeriod = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gameGateway: GameGateway,
  ) {}

  onModuleInit() {
    this.logger.log('Game session manager initialized.');
  }

  onModuleDestroy() {
    this.isRunning = false;
  }

  @Cron('* * * * * *') // Run every second
  async manageGameSession() {
    // Prevent concurrent execution
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      // First, handle any active sessions
      const activeSession = await this.prisma.gameSession.findFirst({
        where: { isActive: true },
        orderBy: { startedAt: 'desc' },
      });

      if (activeSession) {
        const sessionEndTime =
          activeSession.startedAt.getTime() + activeSession.duration * 1000;

        if (Date.now() >= sessionEndTime) {
          // End the session if it's past its duration
          await this.endGameSession(activeSession.id);
        } else {
          // Session is still active - return
          this.isRunning = false;
          return;
        }
      }

      // Check if we need to wait before starting a new session
      const lastSession = await this.prisma.gameSession.findFirst({
        where: { isActive: false },
        orderBy: { endedAt: 'desc' },
      });

      let cooldownRemaining = 0;

      if (lastSession && lastSession.endedAt) {
        const timeSinceLastSession = Date.now() - lastSession.endedAt.getTime();
        cooldownRemaining = Math.max(
          this.cooldownPeriod * 1000 - timeSinceLastSession,
          0,
        );
      }

      if (cooldownRemaining > 0) {
        // Still in cooldown period, notify clients about the waiting time
        const nextSessionInSeconds = Math.ceil(cooldownRemaining / 1000);

        this.logger.log(
          `Waiting ${nextSessionInSeconds}s before starting next session`,
        );
        this.isRunning = false;
        return;
      }

      // Start a new game session
      const newSession = await this.prisma.$transaction(async (prisma) => {
        // Double-check no active session exists (for concurrency safety)
        const doubleCheck = await prisma.gameSession.findFirst({
          where: { isActive: true },
        });

        if (doubleCheck) {
          return doubleCheck;
        }

        // Create new session
        return await prisma.gameSession.create({
          data: {
            isActive: true,
            startedAt: new Date(),
            duration: this.sessionDuration,
            sessionToken: uuidv4(),
          },
        });
      });

      this.logger.log(`New session started with ID: ${newSession.id}`);

      // Broadcast the new session info
      this.gameGateway.notifySessionUpdate({
        session: newSession,
        timeLeftInSeconds: this.sessionDuration,
        nextSessionIn: null,
      });

      // Schedule session end
      setTimeout(() => {
        void this.endGameSession(newSession.id);
      }, this.sessionDuration * 1000);
    } catch (error) {
      this.logger.error('Error managing game session:', error);
    } finally {
      this.isRunning = false;
    }
  }

  private async endGameSession(sessionId: string) {
    try {
      const winningNumber = Math.floor(Math.random() * 10) + 1;
      const endedSession = await this.prisma.gameSession.update({
        where: { id: sessionId },
        data: {
          isActive: false,
          winningNumber,
          endedAt: new Date(),
        },
      });

      this.logger.log(
        `Session ${sessionId} ended, Winning number: ${winningNumber}`,
      );

      // Notify clients that the session has ended
      this.gameGateway.notifySessionUpdate({
        session: null,
        timeLeftInSeconds: null,
        nextSessionIn: this.cooldownPeriod,
      });

      return endedSession;
    } catch (error) {
      this.logger.error(`Error ending session ${sessionId}:`, error);
      throw error;
    }
  }

  // Get active session if any
  async getActiveSession(): Promise<ApiResponse> {
    // First check for active session
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

      if (timeLeftInSeconds > 0) {
        return {
          message: 'Active session found',
          data: {
            session: activeSession,
            timeLeftInSeconds,
            nextSessionIn: null,
            status: 'active',
          },
        };
      }
    }

    // Check for wait time period
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

    return {
      message: 'No active session found',
      data: {
        session: null,
        timeLeftInSeconds: null,
        nextSessionIn,
        status: 'waiting',
      },
    };
  }

  // Join a game session
  async joinGameSession(
    userId: string,
    gameSessionId: string,
  ): Promise<ApiResponse> {
    // Check if the game session exists and is active
    const session = await this.prisma.gameSession.findFirst({
      where: { id: gameSessionId, isActive: true },
    });

    if (!session) {
      throw new BadRequestException(
        'Game session is not active or does not exist.',
      );
    }

    // Check if user has already joined the session
    const existingPlayer = await this.prisma.player.findFirst({
      where: { userId, gameId: session.id },
    });

    if (existingPlayer) {
      if (existingPlayer.selectedNumber !== -1)
        throw new BadRequestException(
          'You have already played in this session.',
        );

      throw new BadRequestException('You have already joined this session.');
    }

    // Add user to the game session
    const player = await this.prisma.player.create({
      data: { userId, gameId: session.id, selectedNumber: -1 }, // default selected number is -1
      include: {
        user: true,
      },
    });

    // Get the updated total number of players in the session
    const totalPlayers = await this.prisma.player.count({
      where: { gameId: session.id },
    });

    const joinResult = {
      totalPlayers,
      lastJoinedPlayer: player.user.username,
    };

    // Emit WebSocket event to notify players
    this.gameGateway.notifyPlayerJoined(joinResult);

    return { message: 'Successfully joined game session.' };
  }

  // Submit a number to play the game
  async submitNumber(
    userId: string,
    gameSessionId: string,
    selectedNumber: number,
  ): Promise<ApiResponse> {
    // Validate number
    if (selectedNumber < 1 || selectedNumber > 10) {
      throw new BadRequestException('Invalid number. Choose between 1 and 10.');
    }

    const session = await this.prisma.gameSession.findFirst({
      where: { id: gameSessionId },
    });
    if (!session) {
      throw new BadRequestException(
        'Game session is not active or does not exist.',
      );
    }

    // Check if the player exists in the session
    const player = await this.prisma.player.findFirst({
      where: { userId, gameId: session.id },
    });

    if (!player) {
      throw new BadRequestException('You have not joined this session.');
    }

    // Ensure the player has not already submitted a number (-1 is the default after joining a room)
    if (player.selectedNumber !== -1) {
      throw new BadRequestException('You have already selected a number.');
    }

    // Save the selected number
    await this.prisma.player.update({
      where: { id: player.id },
      data: { selectedNumber },
    });

    return { message: 'Number submitted successfully.' };
  }

  // Get Game Result
  async getGameResult(gameSessionId: string): Promise<ApiResponse> {
    // Fetch session details & winning number
    const session = await this.prisma.gameSession.findUnique({
      where: { id: gameSessionId },
      select: { id: true, winningNumber: true, endedAt: true },
    });

    if (!session) {
      throw new NotFoundException('Game session not found.');
    }

    if (!session.winningNumber) {
      throw new BadRequestException(
        'Game session not ended and cannot determine winners.',
      );
    }

    const { winningNumber } = session;
    // Calculate stats
    const [totalPlayers, totalWins, winners] = await Promise.all([
      this.prisma.player.count({ where: { gameId: session.id } }),
      this.prisma.player.count({
        where: { gameId: session.id, selectedNumber: winningNumber },
      }),
      this.prisma.player.findMany({
        where: { gameId: session.id, selectedNumber: winningNumber },
        select: { user: { select: { username: true } } },
      }),
    ]);

    // Calculate next session start time (10s after previous session ends)
    const lastSession = await this.prisma.gameSession.findFirst({
      where: { isActive: false },
      orderBy: { endedAt: 'desc' },
    });

    let nextSessionIn = this.cooldownPeriod;

    if (lastSession && lastSession.endedAt) {
      const timeSinceLastSession = Date.now() - lastSession.endedAt.getTime();
      nextSessionIn = Math.max(
        Math.ceil((this.cooldownPeriod * 1000 - timeSinceLastSession) / 1000),
        0,
      );
    }

    // Update win/loss stats in bulk
    await this.updatePlayerStats(gameSessionId, winningNumber);

    // Prepare and emit results
    const resultPayload: GameResultResponse = {
      gameSessionId,
      winningNumber,
      totalPlayers,
      currentPlayer: null,
      totalWins,
      winners,
      nextSessionIn,
    };

    this.gameGateway.notifyGameResult(resultPayload);
    return { message: 'Game result retrieved', data: resultPayload };
  }

  // Get game session by id
  async getGameById(gameId: string, userId: string): Promise<ApiResponse> {
    const session = await this.prisma.gameSession.findFirst({
      where: { id: gameId, isActive: true },
    });

    if (!session) {
      throw new BadRequestException(
        'Game session is not active or does not exist.',
      );
    }
    // Check if user already played this game
    const existingPlayer = await this.prisma.player.findFirst({
      where: { userId, gameId: session.id },
    });

    if (existingPlayer) {
      if (existingPlayer.selectedNumber !== -1)
        throw new BadRequestException(
          'You have already played in this session.',
        );
    }
    // First check for active session
    const gameSession = await this.prisma.gameSession.findUnique({
      where: { id: gameId },
    });

    if (gameSession && gameSession.isActive) {
      const sessionEndTime =
        gameSession.startedAt.getTime() + gameSession.duration * 1000;
      const timeLeftInSeconds = Math.max(
        Math.floor((sessionEndTime - Date.now()) / 1000),
        0,
      );

      if (timeLeftInSeconds > 0) {
        const totalPlayers = await this.prisma.player.count({
          where: { gameId: session.id },
        });
        return {
          message: 'Game session is still active',
          data: {
            session: gameSession,
            timeLeftInSeconds,
            nextSessionIn: null,
            status: 'active',
            totalPlayers,
          },
        };
      }
    }

    // Check for wait time period
    const lastSession = await this.prisma.gameSession.findFirst({
      where: { isActive: false },
      orderBy: { endedAt: 'desc' },
    });

    let nextSessionIn = this.cooldownPeriod;

    if (lastSession && lastSession.endedAt) {
      const timeSinceLastSession = Date.now() - lastSession.endedAt.getTime();
      nextSessionIn = Math.max(
        Math.ceil((this.cooldownPeriod * 1000 - timeSinceLastSession) / 1000),
        0,
      );
    }

    return {
      message: 'Game session no longer active',
      data: {
        session: null,
        timeLeftInSeconds: null,
        nextSessionIn,
        status: 'waiting',
      },
    };
  }

  // Get game session by id
  async getGameStatus(gameId: string): Promise<ApiResponse> {
    const gameSession = await this.prisma.gameSession.findFirst({
      where: { id: gameId },
    });

    if (!gameSession) {
      throw new NotFoundException('Game session ID not found');
    }

    if (gameSession && gameSession.isActive) {
      const sessionEndTime =
        gameSession.startedAt.getTime() + gameSession.duration * 1000;
      const timeLeftInSeconds = Math.max(
        Math.floor((sessionEndTime - Date.now()) / 1000),
        0,
      );

      if (timeLeftInSeconds > 0) {
        const totalPlayers = await this.prisma.player.count({
          where: { gameId },
        });
        return {
          message: 'Game session is still active',
          data: {
            session: gameSession,
            timeLeftInSeconds,
            nextSessionIn: null,
            totalPlayers,
          },
        };
      }
    }

    // Check for wait time period
    const lastSession = await this.prisma.gameSession.findFirst({
      where: { isActive: false },
      orderBy: { endedAt: 'desc' },
    });

    let nextSessionIn = this.cooldownPeriod;

    if (lastSession && lastSession.endedAt) {
      const timeSinceLastSession = Date.now() - lastSession.endedAt.getTime();
      nextSessionIn = Math.max(
        Math.ceil((this.cooldownPeriod * 1000 - timeSinceLastSession) / 1000),
        0,
      );
    }

    return {
      message: 'Game session no longer active',
      data: {
        session: gameSession,
        timeLeftInSeconds: null,
        nextSessionIn,
      },
    };
  }

  async getUserStats(userId: string): Promise<ApiResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    return { message: 'User stats fetched', data: user };
  }

  async updatePlayerStats(gameSessionId: string, winningNumber: number) {
    // Update winners
    await this.prisma.player.updateMany({
      where: { gameId: gameSessionId, selectedNumber: winningNumber },
      data: { isWinner: true },
    });

    // Update losers
    await this.prisma.player.updateMany({
      where: { gameId: gameSessionId, selectedNumber: { not: winningNumber } },
      data: { isWinner: false },
    });

    // Update user total wins & losses in bulk
    await this.prisma.$transaction([
      this.prisma.user.updateMany({
        where: {
          id: {
            in: (await this.getWinners(gameSessionId)).map((w) => w.userId),
          },
        },
        data: { wins: { increment: 1 } },
      }),
      this.prisma.user.updateMany({
        where: {
          id: {
            in: (await this.getLosers(gameSessionId)).map((l) => l.userId),
          },
        },
        data: { losses: { increment: 1 } },
      }),
    ]);
  }

  // Helper methods to fetch winners and losers
  private async getWinners(gameSessionId: string) {
    return this.prisma.player.findMany({
      where: { gameId: gameSessionId, isWinner: true },
      select: { userId: true },
    });
  }

  private async getLosers(gameSessionId: string) {
    return this.prisma.player.findMany({
      where: { gameId: gameSessionId, isWinner: false },
      select: { userId: true },
    });
  }
}
