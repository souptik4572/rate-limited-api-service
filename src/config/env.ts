type EnvConfig = {
  port: number;
  redisUrl: string;
  databaseUrl: string;
  rateLimit: number;
  rateWindowMs: number;
  logLevel: string;
  enableDeferredProcessing: boolean;
  enableRateLimitQueueFallback: boolean;
  queueName: string;
  queueAttempts: number;
  queueBackoffMs: number;
  enableQueueBatching: boolean;
  queueBatchSize: number;
  queueBatchWindowMs: number;
  rateLimitQueueDelayMs: number;
  enableStatsCache: boolean;
  statsCacheTtlSeconds: number;
};

function parseNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];

  if (raw === undefined || raw === '') {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Environment variable ${name} must be a positive number.`);
  }

  return value;
}

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];

  if (raw === undefined || raw === '') {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();

  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  throw new Error(
    `Environment variable ${name} must be a boolean (true/false/1/0/yes/no).`,
  );
}

export function getEnvConfig(): EnvConfig {
  const redisUrl = process.env.REDIS_URL ?? 'redis://redis:6379';
  const databaseUrl =
    process.env.DATABASE_URL ?? 'mysql://root:root@mysql:3306/rate_limiter';

  if (!redisUrl) {
    throw new Error('REDIS_URL is required.');
  }

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }

  return {
    port: parseNumberEnv('PORT', 3000),
    redisUrl,
    databaseUrl,
    rateLimit: parseNumberEnv('RATE_LIMIT', 5),
    rateWindowMs: parseNumberEnv('RATE_WINDOW_MS', 60_000),
    logLevel: process.env.LOG_LEVEL ?? 'info',
    enableDeferredProcessing: parseBooleanEnv(
      'ENABLE_DEFERRED_PROCESSING',
      false,
    ),
    enableRateLimitQueueFallback: parseBooleanEnv(
      'ENABLE_RATE_LIMIT_QUEUE_FALLBACK',
      false,
    ),
    queueName: process.env.QUEUE_NAME ?? 'request-processing',
    queueAttempts: parseNumberEnv('QUEUE_ATTEMPTS', 3),
    queueBackoffMs: parseNumberEnv('QUEUE_BACKOFF_MS', 1_000),
    enableQueueBatching: parseBooleanEnv('ENABLE_QUEUE_BATCHING', false),
    queueBatchSize: parseNumberEnv('QUEUE_BATCH_SIZE', 25),
    queueBatchWindowMs: parseNumberEnv('QUEUE_BATCH_WINDOW_MS', 50),
    rateLimitQueueDelayMs: parseNumberEnv(
      'RATE_LIMIT_QUEUE_DELAY_MS',
      parseNumberEnv('RATE_WINDOW_MS', 60_000),
    ),
    enableStatsCache: parseBooleanEnv('ENABLE_STATS_CACHE', false),
    statsCacheTtlSeconds: parseNumberEnv('STATS_CACHE_TTL_SECONDS', 10),
  };
}

export type { EnvConfig };
