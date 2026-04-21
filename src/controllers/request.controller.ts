import type { FastifyReply, FastifyRequest } from 'fastify';

import type { RateLimiterService } from '../services/rateLimiter.service';
import type { RequestQueueService } from '../services/requestQueue.service';
import type { StatsService } from '../services/stats.service';

type RequestBody = {
  user_id: string;
  payload: Record<string, unknown>;
};

type RequestControllerOptions = {
  rateLimiterService: RateLimiterService;
  statsService: StatsService;
  requestQueueService?: RequestQueueService;
  enableDeferredProcessing: boolean;
  enableRateLimitQueueFallback: boolean;
  rateLimitQueueDelayMs: number;
  rateLimit: number;
  rateWindowMs: number;
  logger: {
    error: (object: Record<string, unknown>, message?: string) => void;
  };
};

export class RequestController {
  private readonly rateLimiterService: RateLimiterService;
  private readonly statsService: StatsService;
  private readonly requestQueueService?: RequestQueueService;
  private readonly enableDeferredProcessing: boolean;
  private readonly enableRateLimitQueueFallback: boolean;
  private readonly rateLimitQueueDelayMs: number;
  private readonly rateLimit: number;
  private readonly rateWindowMs: number;
  private readonly logger: {
    error: (object: Record<string, unknown>, message?: string) => void;
  };

  public constructor(options: RequestControllerOptions) {
    this.rateLimiterService = options.rateLimiterService;
    this.statsService = options.statsService;
    this.requestQueueService = options.requestQueueService;
    this.enableDeferredProcessing = options.enableDeferredProcessing;
    this.enableRateLimitQueueFallback = options.enableRateLimitQueueFallback;
    this.rateLimitQueueDelayMs = options.rateLimitQueueDelayMs;
    this.rateLimit = options.rateLimit;
    this.rateWindowMs = options.rateWindowMs;
    this.logger = options.logger;
  }

  public handle = async (
    request: FastifyRequest<{ Body: RequestBody }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const { user_id: userId, payload } = request.body;
    const accepted = await this.rateLimiterService.checkLimit(userId);

    if (!accepted) {
      await this.statsService.recordRequestOutcome(userId, false);

      if (this.enableRateLimitQueueFallback && this.requestQueueService) {
        await this.requestQueueService.enqueueRateLimited(
          userId,
          payload,
          this.rateLimitQueueDelayMs,
        );
      }

      const retryAfterSeconds = Math.max(1, Math.ceil(this.rateWindowMs / 1000));

      reply.header('Retry-After', String(retryAfterSeconds)).status(429).send({
        error: 'rate_limit_exceeded',
        message: `Max ${this.rateLimit} requests per ${retryAfterSeconds} seconds exceeded`,
      });
      return;
    }

    let handledByQueue = false;

    if (this.enableDeferredProcessing && this.requestQueueService) {
      handledByQueue = await this.requestQueueService.enqueueAccepted(
        userId,
        payload,
      );
    }

    if (!handledByQueue) {
      try {
        await this.processPayload(payload);
      } catch (error) {
        this.logger.error(
          { err: error, userId },
          'Payload processing failed before stats recording.',
        );
        throw error;
      }
    }

    await this.statsService.recordRequestOutcome(userId, true);

    reply.status(200).send({
      status: 'accepted',
    });
  };

  private async processPayload(payload: Record<string, unknown>): Promise<void> {
    await Promise.resolve(payload);
  }
}
