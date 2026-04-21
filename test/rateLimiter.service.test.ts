import { describe, expect, it, vi } from 'vitest';

import { DependencyUnavailableError } from '../src/middleware/error.middleware';
import { RateLimiterService } from '../src/services/rateLimiter.service';

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('RateLimiterService', () => {
  it('returns true when Redis Lua script allows the request', async () => {
    const redis = {
      status: 'ready',
      connect: vi.fn(),
      script: vi.fn().mockResolvedValue('sha123'),
      evalsha: vi.fn().mockResolvedValue(1),
    };
    const logger = createLogger();
    const service = new RateLimiterService({
      redis,
      logger: logger as never,
      limit: 5,
      windowMs: 60_000,
      script: 'return 1',
    });

    await expect(service.checkLimit('user-1')).resolves.toBe(true);
    expect(redis.script).toHaveBeenCalledWith('LOAD', 'return 1');
    expect(redis.evalsha).toHaveBeenCalledTimes(1);
  });

  it('returns false when Redis Lua script rejects the request', async () => {
    const redis = {
      status: 'ready',
      connect: vi.fn(),
      script: vi.fn().mockResolvedValue('sha123'),
      evalsha: vi.fn().mockResolvedValue(0),
    };
    const logger = createLogger();
    const service = new RateLimiterService({
      redis,
      logger: logger as never,
      limit: 5,
      windowMs: 60_000,
      script: 'return 0',
    });

    await expect(service.checkLimit('user-1')).resolves.toBe(false);
  });

  it('reloads the Lua script after a NOSCRIPT error', async () => {
    const redis = {
      status: 'ready',
      connect: vi.fn(),
      script: vi.fn().mockResolvedValue('sha123'),
      evalsha: vi
        .fn()
        .mockRejectedValueOnce(new Error('NOSCRIPT No matching script.'))
        .mockResolvedValueOnce(1),
    };
    const logger = createLogger();
    const service = new RateLimiterService({
      redis,
      logger: logger as never,
      limit: 5,
      windowMs: 60_000,
      script: 'return 1',
    });

    await expect(service.checkLimit('user-1')).resolves.toBe(true);
    expect(redis.script).toHaveBeenCalledTimes(2);
  });

  it('fails closed when Redis is unavailable', async () => {
    const redis = {
      status: 'ready',
      connect: vi.fn(),
      script: vi.fn().mockResolvedValue('sha123'),
      evalsha: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    const logger = createLogger();
    const service = new RateLimiterService({
      redis,
      logger: logger as never,
      limit: 5,
      windowMs: 60_000,
      script: 'return 1',
    });

    await expect(service.checkLimit('user-1')).rejects.toBeInstanceOf(DependencyUnavailableError);
  });
});
