import { DependencyUnavailableError } from '../middleware/error.middleware';

type LoggerLike = {
  error: (object: Record<string, unknown>, message?: string) => void;
};

type UserStatsRecord = {
  userId: string;
  totalRequests: number;
  acceptedRequests: number;
  rejectedRequests: number;
};

type PrismaStatsClient = {
  userStats: {
    upsert: (args: {
      where: { userId: string };
      update: {
        totalRequests: { increment: 1 };
        acceptedRequests?: { increment: 1 };
        rejectedRequests?: { increment: 1 };
      };
      create: {
        userId: string;
        totalRequests: number;
        acceptedRequests: number;
        rejectedRequests: number;
      };
    }) => Promise<unknown>;
    findMany: (args: {
      where?: { userId: string };
      orderBy: { userId: 'asc' };
    }) => Promise<UserStatsRecord[]>;
  };
};

type StatsServiceOptions = {
  prisma: PrismaStatsClient;
  logger: LoggerLike;
  cache?: {
    enabled: boolean;
    ttlSeconds: number;
    redis: {
      get: (key: string) => Promise<string | null>;
      set: (
        key: string,
        value: string,
        mode: 'EX',
        ttlSeconds: number,
      ) => Promise<unknown>;
      del: (...keys: string[]) => Promise<unknown>;
    };
  };
};

export type StatsResponseItem = {
  user_id: string;
  total_requests: number;
  accepted_requests: number;
  rejected_requests: number;
};

export class StatsService {
  private readonly prisma: PrismaStatsClient;
  private readonly logger: LoggerLike;
  private readonly cache?: StatsServiceOptions['cache'];

  public constructor(options: StatsServiceOptions) {
    this.prisma = options.prisma;
    this.logger = options.logger;
    this.cache = options.cache;
  }

  public async recordRequestOutcome(userId: string, accepted: boolean): Promise<void> {
    try {
      await this.prisma.userStats.upsert({
        where: { userId },
        update: {
          totalRequests: { increment: 1 },
          acceptedRequests: accepted ? { increment: 1 } : undefined,
          rejectedRequests: accepted ? undefined : { increment: 1 },
        },
        create: {
          userId,
          totalRequests: 1,
          acceptedRequests: accepted ? 1 : 0,
          rejectedRequests: accepted ? 0 : 1,
        },
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId, accepted },
        'Failed to persist request statistics. Continuing without blocking the response.',
      );
      return;
    }

    if (!this.cache?.enabled) {
      return;
    }

    try {
      await this.cache.redis.del(
        this.getStatsCacheKey(),
        this.getStatsCacheKey(userId),
      );
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        'Failed to invalidate stats cache after request update.',
      );
    }
  }

  public async getStats(userId?: string): Promise<StatsResponseItem[]> {
    const cacheKey = this.getStatsCacheKey(userId);

    if (this.cache?.enabled) {
      try {
        const cached = await this.cache.redis.get(cacheKey);

        if (cached) {
          return JSON.parse(cached) as StatsResponseItem[];
        }
      } catch (error) {
        this.logger.error(
          { err: error, userId },
          'Failed to read stats cache. Falling back to MySQL.',
        );
      }
    }

    try {
      const records = await this.prisma.userStats.findMany({
        where: userId ? { userId } : undefined,
        orderBy: { userId: 'asc' },
      });

      const response = records.map((record) => ({
        user_id: record.userId,
        total_requests: record.totalRequests,
        accepted_requests: record.acceptedRequests,
        rejected_requests: record.rejectedRequests,
      }));

      if (this.cache?.enabled) {
        try {
          await this.cache.redis.set(
            cacheKey,
            JSON.stringify(response),
            'EX',
            this.cache.ttlSeconds,
          );
        } catch (error) {
          this.logger.error(
            { err: error, userId },
            'Failed to write stats cache. Returning MySQL response.',
          );
        }
      }

      return response;
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        'Failed to read request statistics from MySQL.',
      );
      throw new DependencyUnavailableError(
        'Statistics store is unavailable.',
        'mysql',
      );
    }
  }

  private getStatsCacheKey(userId?: string): string {
    if (userId) {
      return `stats:user:${userId}`;
    }

    return 'stats:all';
  }
}
