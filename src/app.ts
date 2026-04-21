import Fastify from 'fastify';

import { getEnvConfig } from './config/env';
import { RequestController } from './controllers/request.controller';
import { StatsController } from './controllers/stats.controller';
import { registerErrorHandler } from './middleware/error.middleware';
import { prisma } from './prisma/client';
import { connectRedis, redis } from './redis/redisClient';
import { requestRoutes } from './routes/request.routes';
import { statsRoutes } from './routes/stats.routes';
import {
  RateLimiterService,
  type RedisScriptClient,
} from './services/rateLimiter.service';
import { StatsService } from './services/stats.service';
import { logger } from './utils/logger';

export async function buildApp() {
  const env = getEnvConfig();
  const app = Fastify({
    loggerInstance: logger,
    disableRequestLogging: false,
    requestTimeout: 10_000,
  });

  registerErrorHandler(app);

  const redisScriptClient: RedisScriptClient = {
    get status() {
      return redis.status;
    },
    connect: () => redis.connect(),
    script: (subcommand, ...args) =>
      redis.script(subcommand as 'LOAD', ...(args as [string])),
    evalsha: (sha, numKeys, ...args) => redis.evalsha(sha, numKeys, ...args),
  };

  const rateLimiterService = new RateLimiterService({
    redis: redisScriptClient,
    logger: app.log,
    limit: env.rateLimit,
    windowMs: env.rateWindowMs,
  });

  const statsService = new StatsService({
    prisma,
    logger: app.log,
  });

  const requestController = new RequestController({
    rateLimiterService,
    statsService,
  });

  const statsController = new StatsController({
    statsService,
  });

  await app.register(requestRoutes, { controller: requestController });
  await app.register(statsRoutes, { controller: statsController });

  app.get('/health', async () => ({
    status: 'ok',
  }));

  app.addHook('onReady', async () => {
    try {
      await connectRedis();
      await rateLimiterService.initialize();
    } catch (error) {
      app.log.error({ err: error }, 'Redis initialization failed. Requests will fail closed until Redis recovers.');
    }

    try {
      await prisma.$connect();
      app.log.info('MySQL connection established');
    } catch (error) {
      app.log.error({ err: error }, 'MySQL initialization failed. Request stats will be best-effort until MySQL recovers.');
    }
  });

  app.addHook('onClose', async () => {
    await Promise.allSettled([redis.quit(), prisma.$disconnect()]);
  });

  return app;
}

async function start(): Promise<void> {
  const env = getEnvConfig();
  const app = await buildApp();

  try {
    await app.listen({
      host: '0.0.0.0',
      port: env.port,
    });
  } catch (error) {
    app.log.error({ err: error }, 'Failed to start server');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void start();
}
