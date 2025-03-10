import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserDto } from './dto/user.dto';
import { ApiResponse } from 'src/utils/interface/interface';
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  // Register a user
  async register(dto: UserDto): Promise<ApiResponse> {
    try {
      const newUser = await this.prisma.user.create({
        data: {
          username: dto.username.trim(), // ensures there are no whitespaces
        },
      });

      return {
        message: 'User successfully created, redirecting to login...',
        data: newUser,
      };
    } catch (error) {
      if (error.code === 'P2002') {
        // Prisma unique constraint error
        throw new BadRequestException('Username is already taken');
      }
      throw error;
    }
  }

  // Login a user
  async login(dto: UserDto): Promise<ApiResponse> {
    const username = dto.username.trim();
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) throw new UnauthorizedException('Invalid username');

    const jwtPayload = { userId: user.id, username: user.username };
    const refreshTokenExpiresAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    );

    // Generate access token (valid for 3 hours)
    const accessToken = await this.jwtService.signAsync(jwtPayload);

    // Generate refresh token (valid for 30 days)
    const refreshToken = await this.jwtService.signAsync(jwtPayload, {
      expiresIn: '30d',
    });

    await this.prisma.refreshToken.upsert({
      where: { userId: user.id },
      update: {
        token: refreshToken,
        expiresAt: refreshTokenExpiresAt,
      },
      create: {
        userId: user.id,
        token: refreshToken,
        expiresAt: refreshTokenExpiresAt,
      },
    });

    const response = {
      accessToken,
      user,
      cookieOptions: {
        refreshToken,
        refreshTokenExpiresAt,
      },
    };

    return {
      message: 'Login successful',
      data: response,
    };
  }

  // Refresh token
  async refreshToken(token: string): Promise<ApiResponse> {
    if (!token) throw new UnauthorizedException('Refresh token not found');

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!storedToken || storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Generate new access token
    const jwtPayload = {
      userId: storedToken.user.id,
      username: storedToken.user.username,
    };
    const newAccessToken = await this.jwtService.signAsync(jwtPayload);

    return {
      message: 'Token refreshed successfully',
      data: { accessToken: newAccessToken },
    };
  }

  // Logout
  async logout(userId: string): Promise<ApiResponse> {
    await this.prisma.refreshToken.delete({ where: { userId } });
    return {
      message: 'User logged out successfully',
      data: { clearCookies: true },
    };
  }
}
