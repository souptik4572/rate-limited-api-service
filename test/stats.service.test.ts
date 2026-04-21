import { describe, expect, it, vi } from 'vitest';

import { StatsService } from '../src/services/stats.service';

function createLogger() {
  return {
    error: vi.fn(),
  };
}

describe('StatsService', () => {
  it('records an accepted request with atomic increments', async () => {
    const prisma = {
      userStats: {
        upsert: vi.fn().mockResolvedValue(undefined),
        findMany: vi.fn(),
      },
    };
    const service = new StatsService({
      prisma,
      logger: createLogger() as never,
    });

    await service.recordRequestOutcome('user-1', true);

    expect(prisma.userStats.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      update: {
        totalRequests: { increment: 1 },
        acceptedRequests: { increment: 1 },
        rejectedRequests: undefined,
      },
      create: {
        userId: 'user-1',
        totalRequests: 1,
        acceptedRequests: 1,
        rejectedRequests: 0,
      },
    });
  });

  it('records a rejected request with atomic increments', async () => {
    const prisma = {
      userStats: {
        upsert: vi.fn().mockResolvedValue(undefined),
        findMany: vi.fn(),
      },
    };
    const service = new StatsService({
      prisma,
      logger: createLogger() as never,
    });

    await service.recordRequestOutcome('user-1', false);

    expect(prisma.userStats.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      update: {
        totalRequests: { increment: 1 },
        acceptedRequests: undefined,
        rejectedRequests: { increment: 1 },
      },
      create: {
        userId: 'user-1',
        totalRequests: 1,
        acceptedRequests: 0,
        rejectedRequests: 1,
      },
    });
  });

  it('returns API-shaped statistics', async () => {
    const prisma = {
      userStats: {
        upsert: vi.fn(),
        findMany: vi.fn().mockResolvedValue([
          {
            userId: 'user-1',
            totalRequests: 10,
            acceptedRequests: 7,
            rejectedRequests: 3,
          },
        ]),
      },
    };
    const service = new StatsService({
      prisma,
      logger: createLogger() as never,
    });

    await expect(service.getStats()).resolves.toEqual([
      {
        user_id: 'user-1',
        total_requests: 10,
        accepted_requests: 7,
        rejected_requests: 3,
      },
    ]);
  });

  it('logs and swallows persistence failures during request processing', async () => {
    const logger = createLogger();
    const prisma = {
      userStats: {
        upsert: vi.fn().mockRejectedValue(new Error('db unavailable')),
        findMany: vi.fn(),
      },
    };
    const service = new StatsService({
      prisma,
      logger: logger as never,
    });

    await expect(service.recordRequestOutcome('user-1', true)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('invalidates cached stats entries after recording an outcome', async () => {
    const cache = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn().mockResolvedValue(2),
    };
    const prisma = {
      userStats: {
        upsert: vi.fn().mockResolvedValue(undefined),
        findMany: vi.fn(),
      },
    };
    const service = new StatsService({
      prisma,
      logger: createLogger() as never,
      cache: {
        enabled: true,
        ttlSeconds: 10,
        redis: cache,
      },
    });

    await service.recordRequestOutcome('user-1', true);

    expect(cache.del).toHaveBeenCalledWith('stats:all', 'stats:user:user-1');
  });

  it('returns cached stats when cache is enabled and present', async () => {
    const cachedValue = JSON.stringify([
      {
        user_id: 'user-1',
        total_requests: 4,
        accepted_requests: 3,
        rejected_requests: 1,
      },
    ]);
    const cache = {
      get: vi.fn().mockResolvedValue(cachedValue),
      set: vi.fn(),
      del: vi.fn(),
    };
    const prisma = {
      userStats: {
        upsert: vi.fn(),
        findMany: vi.fn(),
      },
    };
    const service = new StatsService({
      prisma,
      logger: createLogger() as never,
      cache: {
        enabled: true,
        ttlSeconds: 10,
        redis: cache,
      },
    });

    await expect(service.getStats()).resolves.toEqual([
      {
        user_id: 'user-1',
        total_requests: 4,
        accepted_requests: 3,
        rejected_requests: 1,
      },
    ]);
    expect(prisma.userStats.findMany).not.toHaveBeenCalled();
  });

  it('writes stats to cache on cache miss', async () => {
    const cache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn(),
    };
    const prisma = {
      userStats: {
        upsert: vi.fn(),
        findMany: vi.fn().mockResolvedValue([
          {
            userId: 'user-1',
            totalRequests: 10,
            acceptedRequests: 7,
            rejectedRequests: 3,
          },
        ]),
      },
    };
    const service = new StatsService({
      prisma,
      logger: createLogger() as never,
      cache: {
        enabled: true,
        ttlSeconds: 10,
        redis: cache,
      },
    });

    await service.getStats();

    expect(cache.set).toHaveBeenCalledWith(
      'stats:all',
      JSON.stringify([
        {
          user_id: 'user-1',
          total_requests: 10,
          accepted_requests: 7,
          rejected_requests: 3,
        },
      ]),
      'EX',
      10,
    );
  });
});
