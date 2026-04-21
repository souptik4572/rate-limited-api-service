import Redis from 'ioredis';

import { getEnvConfig } from '../config/env';

const env = getEnvConfig();

export const redis = new Redis(env.redisUrl, {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  connectTimeout: 5_000,
  retryStrategy(attempt: number) {
    return Math.min(attempt * 200, 2_000);
  },
});

export async function connectRedis(): Promise<void> {
  if (redis.status === 'ready' || redis.status === 'connecting') {
    return;
  }

  await redis.connect();
}
