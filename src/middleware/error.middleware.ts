import type { FastifyReply, FastifyRequest } from 'fastify';

export class DependencyUnavailableError extends Error {
  public readonly statusCode = 503;

  public constructor(message: string, public readonly dependency: string) {
    super(message);
    this.name = 'DependencyUnavailableError';
  }
}

export function registerErrorHandler(app: {
  setErrorHandler: (
    handler: (
      error: Error & { statusCode?: number; validation?: unknown },
      request: FastifyRequest,
      reply: FastifyReply,
    ) => void,
  ) => void;
}): void {
  app.setErrorHandler(
    (error: Error & { statusCode?: number; validation?: unknown }, request: FastifyRequest, reply: FastifyReply) => {
      request.log.error({ err: error }, 'Request failed');

      if (error.validation) {
        reply.status(400).send({
          error: 'invalid_request',
          message: error.message,
        });
        return;
      }

      if (error instanceof DependencyUnavailableError) {
        reply.status(error.statusCode).send({
          error: 'dependency_unavailable',
          message: error.message,
          dependency: error.dependency,
        });
        return;
      }

      const statusCode =
        typeof error.statusCode === 'number' && error.statusCode >= 400
          ? error.statusCode
          : 500;

      reply.status(statusCode).send({
        error: statusCode === 500 ? 'internal_server_error' : 'request_failed',
        message:
          statusCode === 500
            ? 'An unexpected error occurred.'
            : error.message,
      });
    },
  );
}
