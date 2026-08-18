import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const { method, url, requestId } = req;
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        this.logger.log(`[${requestId}] ${method} ${url} ${Date.now() - start}ms`);
      }),
    );
  }
}
