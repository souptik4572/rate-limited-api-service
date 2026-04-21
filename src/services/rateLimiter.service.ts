import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { DependencyUnavailableError } from '../middleware/error.middleware';

type LoggerLike = {
  info: (object: Record<string, unknown>, message?: string) => void;
  warn: (message: string) => void;
  error: (object: Record<string, unknown>, message?: string) => void;
};

export type RedisScriptClient = {
  status?: string;
  connect: () => Promise<void>;
  script: (subcommand: string, ...args: string[]) => Promise<unknown>;
  evalsha: (
    sha: string,
    numKeys: number,
    ...args: Array<string | number>
  ) => Promise<unknown>;
};

type RateLimiterServiceOptions = {
  redis: RedisScriptClient;
  logger: LoggerLike;
  limit: number;
  windowMs: number;
  script?: string;
};

function resolveLuaScript(): string {
  const candidatePaths = [
    path.resolve(process.cwd(), 'src/redis/rateLimiter.lua'),
    path.resolve(process.cwd(), 'dist/redis/rateLimiter.lua'),
  ];

  for (const candidatePath of candidatePaths) {
    try {
      return readFileSync(candidatePath, 'utf8');
    } catch {
      continue;
    }
  }

  throw new Error('Unable to load Redis rate limiter Lua script.');
}

function isNoscriptError(error: unknown): error is Error {
  return error instanceof Error && error.message.includes('NOSCRIPT');
}

export class RateLimiterService {
  private readonly redis: RedisScriptClient;
  private readonly logger: LoggerLike;
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly script: string;
  private scriptSha: string | null = null;

  public constructor(options: RateLimiterServiceOptions) {
    this.redis = options.redis;
    this.logger = options.logger;
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.script = options.script ?? resolveLuaScript();
  }

  public async initialize(): Promise<void> {
    await this.ensureRedisConnection();
    this.scriptSha = String(await this.redis.script('LOAD', this.script));
    this.logger.info({ scriptSha: this.scriptSha }, 'Redis rate limiter script loaded');
  }

  public async checkLimit(userId: string): Promise<boolean> {
    try {
      await this.ensureScriptLoaded();

      const key = `rate_limit:${userId}`;
      const now = Date.now();
      const requestId = randomUUID();
      const result = Number(
        await this.redis.evalsha(
          this.scriptSha as string,
          1,
          key,
          now,
          this.windowMs,
          this.limit,
          requestId,
        ),
      );

      return result === 1;
    } catch (error) {
      if (isNoscriptError(error)) {
        this.logger.warn('Redis script cache was flushed. Reloading Lua script.');
        await this.initialize();
        return this.checkLimit(userId);
      }

      this.logger.error({ err: error, userId }, 'Rate limiter unavailable');
      throw new DependencyUnavailableError(
        'Rate limiter is unavailable. Requests are being rejected to fail closed.',
        'redis',
      );
    }
  }

  private async ensureScriptLoaded(): Promise<void> {
    if (this.scriptSha) {
      return;
    }

    await this.initialize();
  }

  private async ensureRedisConnection(): Promise<void> {
    if (this.redis.status === 'ready' || this.redis.status === 'connecting') {
      return;
    }

    await this.redis.connect();
  }
}
