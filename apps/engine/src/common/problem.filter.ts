import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ProblemBody, ProblemException } from './problem';

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const traceId = (req.headers['x-request-id'] as string) ?? 'unknown';

    const body = this.toProblem(exception);
    if (body.status >= 500) {
      this.logger.error({ err: exception, traceId }, 'unhandled error');
    }

    res
      .status(body.status)
      .type('application/problem+json')
      .json({ ...body, instance: req.originalUrl, traceId });
  }

  private toProblem(exception: unknown): ProblemBody {
    if (exception instanceof ProblemException) return exception.problem;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const slug =
        status === HttpStatus.UNAUTHORIZED
          ? 'unauthorized'
          : status === HttpStatus.NOT_FOUND
            ? 'not-found'
            : status < 500
              ? 'invalid-request'
              : 'internal-error';
      const response = exception.getResponse();
      const detail =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? exception.message);
      return {
        type: `https://marketplace.local/problems/${slug}`,
        title: exception.name,
        status,
        detail: Array.isArray(detail) ? detail.join('; ') : detail,
      };
    }

    return {
      type: 'https://marketplace.local/problems/internal-error',
      title: 'Internal Server Error',
      status: 500,
    };
  }
}
