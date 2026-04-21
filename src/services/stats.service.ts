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

  public constructor(options: StatsServiceOptions) {
    this.prisma = options.prisma;
    this.logger = options.logger;
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
    }
  }

  public async getStats(userId?: string): Promise<StatsResponseItem[]> {
    try {
      const records = await this.prisma.userStats.findMany({
        where: userId ? { userId } : undefined,
        orderBy: { userId: 'asc' },
      });

      return records.map((record) => ({
        user_id: record.userId,
        total_requests: record.totalRequests,
        accepted_requests: record.acceptedRequests,
        rejected_requests: record.rejectedRequests,
      }));
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
}
