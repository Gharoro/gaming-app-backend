import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = (
      request.headers['authorization'] as string | undefined
    )?.split(' ')[1];

    if (!token) {
      throw new HttpException('Please login', HttpStatus.UNAUTHORIZED);
    }

    try {
      const decoded = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET,
      });

      request['user'] = decoded;
      return true;
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        throw new HttpException(
          'Session expired, please login.',
          HttpStatus.UNAUTHORIZED,
        );
      }
      throw error;
    }
  }
}
