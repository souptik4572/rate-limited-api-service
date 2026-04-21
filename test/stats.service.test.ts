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
});
