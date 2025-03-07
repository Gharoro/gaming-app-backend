import { Module } from '@nestjs/common';
import { GameService } from './game.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { GameController } from './game.controller';
import { GameGateway } from './game.gateway';

@Module({
  providers: [GameService, PrismaService, GameGateway],
  controllers: [GameController],
})
export class GameModule {}
