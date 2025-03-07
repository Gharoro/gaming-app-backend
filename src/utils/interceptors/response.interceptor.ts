/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map } from 'rxjs/operators';
import { Observable } from 'rxjs';
import { Response } from 'express';
import { COOKIE_NAME } from '../constants/constants';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();

    if (request.url.includes('health')) {
      return next.handle();
    }

    return next.handle().pipe(
      map((response) => {
        const { message, ...data } = response || {};

        // Handle cookies if data contains cookie info
        if (data && data.data && data.data.cookieOptions) {
          const res = context.switchToHttp().getResponse<Response>();
          const { refreshToken, refreshTokenExpiresAt } =
            data.data.cookieOptions;

          res.cookie(COOKIE_NAME, refreshToken as string, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
            expires: refreshTokenExpiresAt,
          });

          // Remove cookieOptions by creating a new object without it
          const { cookieOptions, ...cleanData } = data.data;
          data.data = cleanData;
        }

        if (data?.data?.clearCookies) {
          const res = context.switchToHttp().getResponse<Response>();

          res.clearCookie(COOKIE_NAME, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
          });
        }

        return {
          success: true,
          statusCode: context.switchToHttp().getResponse().statusCode,
          message: message || 'Success',
          data: data?.data || null,
        };
      }),
    );
  }
}
