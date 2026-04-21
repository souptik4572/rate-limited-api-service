import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

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

type AppConfig = Pick<
  EnvConfig,
  | 'port'
  | 'rateLimit'
  | 'rateWindowMs'
  | 'logLevel'
  | 'enableDeferredProcessing'
  | 'enableRateLimitQueueFallback'
  | 'queueName'
  | 'queueAttempts'
  | 'queueBackoffMs'
  | 'enableQueueBatching'
  | 'queueBatchSize'
  | 'queueBatchWindowMs'
  | 'rateLimitQueueDelayMs'
  | 'enableStatsCache'
  | 'statsCacheTtlSeconds'
>;

const defaultAppConfig: AppConfig = {
  port: 3000,
  rateLimit: 5,
  rateWindowMs: 60_000,
  logLevel: 'info',
  enableDeferredProcessing: false,
  enableRateLimitQueueFallback: false,
  queueName: 'request-processing',
  queueAttempts: 3,
  queueBackoffMs: 1_000,
  enableQueueBatching: false,
  queueBatchSize: 25,
  queueBatchWindowMs: 50,
  rateLimitQueueDelayMs: 60_000,
  enableStatsCache: false,
  statsCacheTtlSeconds: 10,
};

type LooseConfigValue = string | number | boolean | undefined;

function loadAppConfigFromFile(): Partial<AppConfig> {
  const configPath = path.resolve(process.cwd(), 'config.json');

  if (!existsSync(configPath)) {
    return {};
  }

  const raw = readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('config.json must contain a JSON object.');
  }

  return parsed as Partial<AppConfig>;
}

function parsePositiveNumber(
  sourceName: string,
  raw: LooseConfigValue,
  fallback: number,
): number {
  if (raw === undefined || raw === '') {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${sourceName} must be a positive number.`);
  }

  return value;
}

function parseNumberSetting(
  envName: string,
  fileValue: LooseConfigValue,
  fallback: number,
): number {
  const envValue = process.env[envName];
  const sourceValue = envValue ?? fileValue;
  const sourceName = envValue !== undefined ? `Environment variable ${envName}` : `config.json field ${envName}`;

  return parsePositiveNumber(sourceName, sourceValue, fallback);
}

function parseBooleanValue(
  sourceName: string,
  raw: LooseConfigValue,
  fallback: boolean,
): boolean {
  if (raw === undefined || raw === '') {
    return fallback;
  }

  if (typeof raw === 'boolean') {
    return raw;
  }

  const normalized = String(raw).trim().toLowerCase();

  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  throw new Error(
    `${sourceName} must be a boolean (true/false/1/0/yes/no).`,
  );
}

function parseBooleanSetting(
  envName: string,
  fileValue: LooseConfigValue,
  fallback: boolean,
): boolean {
  const envValue = process.env[envName];
  const sourceValue = envValue ?? fileValue;
  const sourceName = envValue !== undefined ? `Environment variable ${envName}` : `config.json field ${envName}`;

  return parseBooleanValue(sourceName, sourceValue, fallback);
}

function parseStringSetting(
  envName: string,
  fileValue: LooseConfigValue,
  fallback: string,
): string {
  const envValue = process.env[envName];
  const sourceValue = envValue ?? fileValue;

  if (sourceValue === undefined || sourceValue === '') {
    return fallback;
  }

  return String(sourceValue);
}

export function getEnvConfig(): EnvConfig {
  const appConfig = {
    ...defaultAppConfig,
    ...loadAppConfigFromFile(),
  };
  const redisUrl = process.env.REDIS_URL ?? 'redis://redis:6379';
  const databaseUrl =
    process.env.DATABASE_URL ?? 'mysql://root:root@mysql:3306/rate_limiter';

  if (!redisUrl) {
    throw new Error('REDIS_URL is required.');
  }

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }

  const rateWindowMs = parseNumberSetting(
    'RATE_WINDOW_MS',
    appConfig.rateWindowMs,
    defaultAppConfig.rateWindowMs,
  );

  return {
    port: parseNumberSetting('PORT', appConfig.port, defaultAppConfig.port),
    redisUrl,
    databaseUrl,
    rateLimit: parseNumberSetting(
      'RATE_LIMIT',
      appConfig.rateLimit,
      defaultAppConfig.rateLimit,
    ),
    rateWindowMs,
    logLevel: parseStringSetting('LOG_LEVEL', appConfig.logLevel, defaultAppConfig.logLevel),
    enableDeferredProcessing: parseBooleanSetting(
      'ENABLE_DEFERRED_PROCESSING',
      appConfig.enableDeferredProcessing,
      defaultAppConfig.enableDeferredProcessing,
    ),
    enableRateLimitQueueFallback: parseBooleanSetting(
      'ENABLE_RATE_LIMIT_QUEUE_FALLBACK',
      appConfig.enableRateLimitQueueFallback,
      defaultAppConfig.enableRateLimitQueueFallback,
    ),
    queueName: parseStringSetting('QUEUE_NAME', appConfig.queueName, defaultAppConfig.queueName),
    queueAttempts: parseNumberSetting(
      'QUEUE_ATTEMPTS',
      appConfig.queueAttempts,
      defaultAppConfig.queueAttempts,
    ),
    queueBackoffMs: parseNumberSetting(
      'QUEUE_BACKOFF_MS',
      appConfig.queueBackoffMs,
      defaultAppConfig.queueBackoffMs,
    ),
    enableQueueBatching: parseBooleanSetting(
      'ENABLE_QUEUE_BATCHING',
      appConfig.enableQueueBatching,
      defaultAppConfig.enableQueueBatching,
    ),
    queueBatchSize: parseNumberSetting(
      'QUEUE_BATCH_SIZE',
      appConfig.queueBatchSize,
      defaultAppConfig.queueBatchSize,
    ),
    queueBatchWindowMs: parseNumberSetting(
      'QUEUE_BATCH_WINDOW_MS',
      appConfig.queueBatchWindowMs,
      defaultAppConfig.queueBatchWindowMs,
    ),
    rateLimitQueueDelayMs: parseNumberSetting(
      'RATE_LIMIT_QUEUE_DELAY_MS',
      appConfig.rateLimitQueueDelayMs,
      rateWindowMs,
    ),
    enableStatsCache: parseBooleanSetting(
      'ENABLE_STATS_CACHE',
      appConfig.enableStatsCache,
      defaultAppConfig.enableStatsCache,
    ),
    statsCacheTtlSeconds: parseNumberSetting(
      'STATS_CACHE_TTL_SECONDS',
      appConfig.statsCacheTtlSeconds,
      defaultAppConfig.statsCacheTtlSeconds,
    ),
  };
}

export type { EnvConfig };
