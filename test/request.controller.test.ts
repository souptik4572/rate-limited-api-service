import { describe, expect, it, vi } from 'vitest';

import { RequestController } from '../src/controllers/request.controller';

function createReply() {
  const reply = {
    header: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    send: vi.fn(),
  };

  return reply;
}

describe('RequestController', () => {
  it('enqueues accepted requests when deferred processing is enabled', async () => {
    const rateLimiterService = {
      checkLimit: vi.fn().mockResolvedValue(true),
    };
    const statsService = {
      recordRequestOutcome: vi.fn().mockResolvedValue(undefined),
    };
    const requestQueueService = {
      enqueueAccepted: vi.fn().mockResolvedValue(true),
      enqueueRateLimited: vi.fn(),
    };
    const logger = { error: vi.fn() };
    const controller = new RequestController({
      rateLimiterService: rateLimiterService as never,
      statsService: statsService as never,
      requestQueueService: requestQueueService as never,
      enableDeferredProcessing: true,
      enableRateLimitQueueFallback: false,
      rateLimitQueueDelayMs: 60_000,
      rateLimit: 5,
      rateWindowMs: 60_000,
      logger,
    });
    const reply = createReply();

    await controller.handle(
      {
        body: {
          user_id: 'user-1',
          payload: { hello: 'world' },
        },
      } as never,
      reply as never,
    );

    expect(requestQueueService.enqueueAccepted).toHaveBeenCalledWith('user-1', {
      hello: 'world',
    });
    expect(statsService.recordRequestOutcome).toHaveBeenCalledWith('user-1', true);
    expect(reply.status).toHaveBeenCalledWith(200);
  });

  it('enqueues rate-limited requests for delayed processing when fallback is enabled', async () => {
    const rateLimiterService = {
      checkLimit: vi.fn().mockResolvedValue(false),
    };
    const statsService = {
      recordRequestOutcome: vi.fn().mockResolvedValue(undefined),
    };
    const requestQueueService = {
      enqueueAccepted: vi.fn(),
      enqueueRateLimited: vi.fn().mockResolvedValue(true),
    };
    const controller = new RequestController({
      rateLimiterService: rateLimiterService as never,
      statsService: statsService as never,
      requestQueueService: requestQueueService as never,
      enableDeferredProcessing: false,
      enableRateLimitQueueFallback: true,
      rateLimitQueueDelayMs: 60_000,
      rateLimit: 12,
      rateWindowMs: 30_000,
      logger: { error: vi.fn() },
    });
    const reply = createReply();

    await controller.handle(
      {
        body: {
          user_id: 'user-1',
          payload: { hello: 'world' },
        },
      } as never,
      reply as never,
    );

    expect(statsService.recordRequestOutcome).toHaveBeenCalledWith('user-1', false);
    expect(requestQueueService.enqueueRateLimited).toHaveBeenCalledWith(
      'user-1',
      { hello: 'world' },
      60_000,
    );
    expect(reply.header).toHaveBeenCalledWith('Retry-After', '30');
    expect(reply.status).toHaveBeenCalledWith(429);
    expect(reply.send).toHaveBeenCalledWith({
      error: 'rate_limit_exceeded',
      message: 'Max 12 requests per 30 seconds exceeded',
    });
  });
});
