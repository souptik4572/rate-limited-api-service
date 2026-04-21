import type { FastifyPluginAsync } from 'fastify';

import type { StatsController } from '../controllers/stats.controller';

type StatsRoutesOptions = {
  controller: StatsController;
};

export const statsRoutes: FastifyPluginAsync<StatsRoutesOptions> = async (
  app,
  options,
) => {
  app.get('/stats', {
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          user_id: { type: 'string', minLength: 1 },
        },
      },
      response: {
        200: {
          type: 'object',
          required: ['users'],
          properties: {
            users: {
              type: 'array',
              items: {
                type: 'object',
                required: [
                  'user_id',
                  'total_requests',
                  'accepted_requests',
                  'rejected_requests',
                ],
                properties: {
                  user_id: { type: 'string' },
                  total_requests: { type: 'integer' },
                  accepted_requests: { type: 'integer' },
                  rejected_requests: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    },
    handler: options.controller.handle,
  });
};
