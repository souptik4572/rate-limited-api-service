import type { FastifyReply, FastifyRequest } from 'fastify';

import type { StatsService } from '../services/stats.service';

type StatsQuery = {
  user_id?: string;
};

type StatsControllerOptions = {
  statsService: StatsService;
};

export class StatsController {
  private readonly statsService: StatsService;

  public constructor(options: StatsControllerOptions) {
    this.statsService = options.statsService;
  }

  public handle = async (
    request: FastifyRequest<{ Querystring: StatsQuery }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const users = await this.statsService.getStats(request.query.user_id);
    reply.status(200).send({ users });
  };
}
