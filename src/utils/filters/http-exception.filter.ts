import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { COOKIE_NAME } from '../constants/constants';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error, please try again';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const errorResponse = exception.getResponse();
      message =
        typeof errorResponse === 'string'
          ? errorResponse
          : (errorResponse as any).message;

      if (
        status === HttpStatus.UNAUTHORIZED &&
        request.url.includes('/refresh-token')
      ) {
        response.clearCookie(COOKIE_NAME, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        });
      }
    }

    this.logger.error(
      `HTTP ${status} - ${request.method} ${request.url}`,
      JSON.stringify({ message, stack: (exception as any)?.stack }),
    );

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
    });
  }
}
