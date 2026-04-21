import { Queue, Worker, type JobsOptions } from 'bullmq';
import Redis from 'ioredis';

type LoggerLike = {
  info: (object: Record<string, unknown>, message?: string) => void;
  warn: (message: string) => void;
  error: (object: Record<string, unknown>, message?: string) => void;
};

type RequestQueuePayload = Record<string, unknown>;

type RequestQueueJobData = {
  userId: string;
  payload: RequestQueuePayload;
  reason: 'accepted' | 'rate_limited';
};

type PendingJob = {
  name: string;
  data: RequestQueueJobData;
  options: JobsOptions;
};

type RequestQueueServiceOptions = {
  logger: LoggerLike;
  redisUrl: string;
  queueName: string;
  enabled: boolean;
  enableBatching: boolean;
  batchSize: number;
  batchWindowMs: number;
  attempts: number;
  backoffMs: number;
  processPayload: (payload: RequestQueuePayload) => Promise<void>;
};

export class RequestQueueService {
  private readonly logger: LoggerLike;
  private readonly redisUrl: string;
  private readonly queueName: string;
  private readonly enabled: boolean;
  private readonly enableBatching: boolean;
  private readonly batchSize: number;
  private readonly batchWindowMs: number;
  private readonly processPayload: (payload: RequestQueuePayload) => Promise<void>;
  private readonly defaultJobOptions: JobsOptions;

  private queue: Queue<RequestQueueJobData> | null = null;
  private worker: Worker<RequestQueueJobData> | null = null;
  private queueConnection: Redis | null = null;
  private workerConnection: Redis | null = null;
  private pendingJobs: PendingJob[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  public constructor(options: RequestQueueServiceOptions) {
    this.logger = options.logger;
    this.redisUrl = options.redisUrl;
    this.queueName = options.queueName;
    this.enabled = options.enabled;
    this.enableBatching = options.enableBatching;
    this.batchSize = options.batchSize;
    this.batchWindowMs = options.batchWindowMs;
    this.processPayload = options.processPayload;
    this.defaultJobOptions = {
      removeOnComplete: 500,
      removeOnFail: 500,
      attempts: options.attempts,
      backoff: {
        type: 'exponential',
        delay: options.backoffMs,
      },
    };
  }

  public async initialize(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    this.queueConnection = new Redis(this.redisUrl, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
      connectTimeout: 5_000,
      retryStrategy(attempt: number) {
        return Math.min(attempt * 200, 2_000);
      },
    });

    this.workerConnection = new Redis(this.redisUrl, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
      connectTimeout: 5_000,
      retryStrategy(attempt: number) {
        return Math.min(attempt * 200, 2_000);
      },
    });

    this.queue = new Queue<RequestQueueJobData>(this.queueName, {
      connection: this.queueConnection,
      defaultJobOptions: this.defaultJobOptions,
    });

    this.worker = new Worker<RequestQueueJobData>(
      this.queueName,
      async (job) => {
        await this.processPayload(job.data.payload);
      },
      {
        connection: this.workerConnection,
        concurrency: 10,
      },
    );

    this.worker.on('failed', (job, error) => {
      this.logger.error(
        {
          err: error,
          jobId: job?.id,
          userId: job?.data.userId,
          reason: job?.data.reason,
          attemptsMade: job?.attemptsMade,
        },
        'Deferred job failed after worker attempt.',
      );
    });

    this.worker.on('error', (error) => {
      this.logger.error(
        { err: error },
        'BullMQ worker error. Deferred processing may be delayed.',
      );
    });

    await this.worker.waitUntilReady();
    await this.queue.waitUntilReady();

    this.logger.info(
      {
        queueName: this.queueName,
        batchingEnabled: this.enableBatching,
        batchSize: this.batchSize,
        batchWindowMs: this.batchWindowMs,
      },
      'Deferred processing queue initialized.',
    );
  }

  public async enqueueAccepted(
    userId: string,
    payload: RequestQueuePayload,
  ): Promise<boolean> {
    return this.enqueue('request.accepted', userId, payload, 'accepted');
  }

  public async enqueueRateLimited(
    userId: string,
    payload: RequestQueuePayload,
    delayMs: number,
  ): Promise<boolean> {
    return this.enqueue(
      'request.rate_limited',
      userId,
      payload,
      'rate_limited',
      delayMs,
    );
  }

  public async close(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    this.clearFlushTimer();
    await this.flushPendingJobs();

    await Promise.allSettled([
      this.worker?.close(),
      this.queue?.close(),
      this.workerConnection?.quit(),
      this.queueConnection?.quit(),
    ]);
  }

  private async enqueue(
    name: string,
    userId: string,
    payload: RequestQueuePayload,
    reason: RequestQueueJobData['reason'],
    delayMs?: number,
  ): Promise<boolean> {
    if (!this.enabled || !this.queue) {
      return false;
    }

    const options =
      delayMs && delayMs > 0
        ? { ...this.defaultJobOptions, delay: delayMs }
        : this.defaultJobOptions;

    try {
      if (this.enableBatching) {
        this.pendingJobs.push({
          name,
          data: { userId, payload, reason },
          options,
        });

        if (this.pendingJobs.length >= this.batchSize) {
          await this.flushPendingJobs();
        } else {
          this.armFlushTimer();
        }

        return true;
      }

      await this.queue.add(name, { userId, payload, reason }, options);
      return true;
    } catch (error) {
      this.logger.error(
        { err: error, userId, reason },
        'Failed to enqueue deferred job.',
      );
      return false;
    }
  }

  private armFlushTimer(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      void this.flushPendingJobs();
    }, this.batchWindowMs);
  }

  private clearFlushTimer(): void {
    if (!this.flushTimer) {
      return;
    }

    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  private async flushPendingJobs(): Promise<void> {
    if (!this.queue || this.pendingJobs.length === 0) {
      this.clearFlushTimer();
      return;
    }

    const jobs = this.pendingJobs.splice(0, this.pendingJobs.length);
    this.clearFlushTimer();

    try {
      await this.queue.addBulk(
        jobs.map((job) => ({
          name: job.name,
          data: job.data,
          opts: job.options,
        })),
      );
    } catch (error) {
      this.logger.error(
        { err: error, batchSize: jobs.length },
        'Failed to flush batched deferred jobs.',
      );
    }
  }
}
