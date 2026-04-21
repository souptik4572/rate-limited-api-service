type EnvConfig = {
  port: number;
  redisUrl: string;
  databaseUrl: string;
  rateLimit: number;
  rateWindowMs: number;
  logLevel: string;
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
  };
}

export type { EnvConfig };
