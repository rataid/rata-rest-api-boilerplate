import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { nowInJakartaIso } from '../utils/date.util';

interface ErrorResponseBody {
  success: false;
  statusCode: number;
  error: string;
  message: string[];
  path: string;
  timestamp: string;
  requestId?: string;
}

const PRISMA_ERROR_MAP: Record<string, { status: number; message: string }> = {
  P2002: { status: HttpStatus.CONFLICT, message: 'Resource already exists' },
  P2025: { status: HttpStatus.NOT_FOUND, message: 'Resource not found' },
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);
  private readonly isProduction = process.env.NODE_ENV === 'production';

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, error, message } = this.resolveException(exception);
    const logLine = `[${request.requestId}] ${request.method} ${request.url} -> ${status}`;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Unexpected server-side failure: log full stack trace so it can be debugged.
      this.logger.error(logLine, exception instanceof Error ? exception.stack : String(exception));
    } else {
      // Expected client error (validation, auth, not found, etc.): one line, no stack trace noise.
      this.logger.warn(`${logLine} ${JSON.stringify(message)}`);
    }

    const body: ErrorResponseBody = {
      success: false,
      statusCode: status,
      error,
      message,
      path: request.url,
      timestamp: nowInJakartaIso(),
      requestId: request.requestId,
    };

    response.status(status).json(body);
  }

  private resolveException(exception: unknown): {
    status: number;
    error: string;
    message: string[];
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        return { status, error: exception.name, message: [payload] };
      }

      const { error, message } = payload as { error?: string; message?: string | string[] };

      return {
        status,
        error: error ?? exception.name,
        message: Array.isArray(message) ? message : [message ?? exception.message],
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = PRISMA_ERROR_MAP[exception.code];
      if (mapped) {
        return { status: mapped.status, error: 'Prisma Error', message: [mapped.message] };
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: [
        this.isProduction
          ? 'Internal server error'
          : exception instanceof Error
            ? exception.message
            : String(exception),
      ],
    };
  }
}
