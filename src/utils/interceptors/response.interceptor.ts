import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map } from 'rxjs/operators';
import { Observable } from 'rxjs';

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
