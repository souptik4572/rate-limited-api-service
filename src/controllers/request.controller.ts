import type { FastifyReply, FastifyRequest } from 'fastify';

import type { RateLimiterService } from '../services/rateLimiter.service';
import type { StatsService } from '../services/stats.service';

type RequestBody = {
  user_id: string;
  payload: Record<string, unknown>;
};

type RequestControllerOptions = {
  rateLimiterService: RateLimiterService;
  statsService: StatsService;
};

export class RequestController {
  private readonly rateLimiterService: RateLimiterService;
  private readonly statsService: StatsService;

  public constructor(options: RequestControllerOptions) {
    this.rateLimiterService = options.rateLimiterService;
    this.statsService = options.statsService;
  }

  public handle = async (
    request: FastifyRequest<{ Body: RequestBody }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const { user_id: userId, payload } = request.body;
    const accepted = await this.rateLimiterService.checkLimit(userId);

    if (!accepted) {
      await this.statsService.recordRequestOutcome(userId, false);
      reply.header('Retry-After', '60').status(429).send({
        error: 'rate_limit_exceeded',
        message: 'Max 5 requests per minute exceeded',
      });
      return;
    }

    await this.processPayload(payload);
    await this.statsService.recordRequestOutcome(userId, true);

    reply.status(200).send({
      status: 'accepted',
    });
  };

  private async processPayload(payload: Record<string, unknown>): Promise<void> {
    await Promise.resolve(payload);
  }
}
