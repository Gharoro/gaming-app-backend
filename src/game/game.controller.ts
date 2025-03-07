import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { GameService } from './game.service';
import { AuthGuard } from 'src/utils/guards/auth.guard';
import { JoinSessionDto } from './dto/join-session.dto';
import { AuthUser } from 'src/utils/decorators/auth-user.decorator';
import { JwtUser } from 'src/utils/interface/interface';
import { PlayGameDto } from './dto/play-game.dto';

@ApiTags('Game')
@ApiBearerAuth('JWT-auth')
@ApiSecurity('JWT-auth')
@Controller('/v1/game')
@UseGuards(AuthGuard)
export class GameController {
  constructor(private readonly gameService: GameService) {}

  @Get('/active')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Finds an active game session' })
  @ApiResponse({ status: 200, description: 'Success' })
  async getActiveSession() {
    return await this.gameService.getActiveSession();
  }

  @Get('/session/:gameId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Returns a game session by Id' })
  @ApiResponse({ status: 200, description: 'Success' })
  async getGameSession(
    @Param('gameId') gameId: string,
    @AuthUser() user: JwtUser,
  ) {
    return await this.gameService.getGameById(gameId, user.userId);
  }

  @Post('/join')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Joins a game session' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Error joining game session' })
  async joinAGameSession(
    @Body() body: JoinSessionDto,
    @AuthUser() user: JwtUser,
  ) {
    return await this.gameService.joinGameSession(
      user.userId,
      body.gameSessionId,
    );
  }

  @Put('/play')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submits a number to play' })
  @ApiResponse({ status: 200, description: 'Number submitted successfully.' })
  @ApiResponse({ status: 400, description: 'Error submitting a nummber' })
  async playGame(@Body() body: PlayGameDto, @AuthUser() user: JwtUser) {
    return await this.gameService.submitNumber(
      user.userId,
      body.gameSessionId,
      Number(body.selectedNumber),
    );
  }

  @Get('/result/:gameId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Returns the result of a game session' })
  @ApiResponse({ status: 200, description: 'Success' })
  async getGameSessionResult(@Param('gameId') gameId: string) {
    return await this.gameService.getGameResult(gameId);
  }

  @Get('/user-stats')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Returns a user stats' })
  @ApiResponse({ status: 200, description: 'User stats fetched successfully' })
  @ApiResponse({ status: 400, description: 'Error fetching user stats' })
  async fetchUserUser(@AuthUser() user: JwtUser) {
    return await this.gameService.getUserStats(user.userId);
  }
}
