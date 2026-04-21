import type { FastifyPluginAsync } from 'fastify';

import type { RequestController } from '../controllers/request.controller';

type RequestRoutesOptions = {
  controller: RequestController;
};

const requestBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['user_id', 'payload'],
  properties: {
    user_id: { type: 'string', minLength: 1 },
    payload: { type: 'object' },
  },
} as const;

export const requestRoutes: FastifyPluginAsync<RequestRoutesOptions> = async (
  app,
  options,
) => {
  app.post('/request', {
    schema: {
      body: requestBodySchema,
      response: {
        200: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string' },
          },
        },
        429: {
          type: 'object',
          required: ['error', 'message'],
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: options.controller.handle,
  });
};
