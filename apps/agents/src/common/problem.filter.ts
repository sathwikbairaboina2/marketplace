import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { ProblemBody, ProblemException } from './problem';

/** Shared by the HTTP filter and the socket gateway, so both channels agree. */
export function toProblem(exception: unknown): ProblemBody {
  if (exception instanceof ProblemException) return exception.problem;

  if (exception instanceof HttpException) {
    const status = exception.getStatus();

    if (status >= 500) {
      return {
        type: 'https://marketplace.local/problems/internal-error',
        title: 'Internal Server Error',
        status,
      };
    }

    const slug =
      status === HttpStatus.UNAUTHORIZED
        ? 'unauthorized'
        : status === HttpStatus.NOT_FOUND
          ? 'not-found'
          : 'invalid-request';
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

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    // Socket exceptions are handled inside the gateway, which needs the socket
    // instance to emit on; only HTTP reaches this filter.
    if (host.getType() !== 'http') return;

    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const traceId =
      (req as unknown as { id?: string }).id ??
      (req.headers['x-request-id'] as string | undefined) ??
      'unknown';

    const body = toProblem(exception);
    if (body.status >= 500) {
      this.logger.error({ err: exception, traceId }, 'unhandled error');
    }

    res
      .status(body.status)
      .type('application/problem+json')
      .json({ ...body, instance: req.originalUrl, traceId });
  }
}
