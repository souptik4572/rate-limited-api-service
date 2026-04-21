# Rate-Limited API Service

Production-grade Fastify service that enforces a strict sliding-window rate
limit of 5 requests per user per minute using Redis Lua scripting, while
persisting per-user analytics in MySQL through Prisma.

## Stack

- Node.js 20+
- TypeScript
- Fastify
- Redis + Lua script
- MySQL + Prisma
- Docker Compose

## Project Structure

```text
.
├── docker-compose.yml
├── Dockerfile
├── package.json
├── prisma
│   ├── migrations
│   └── schema.prisma
├── scripts
│   └── load-test.ts
├── src
│   ├── app.ts
│   ├── config
│   ├── controllers
│   ├── middleware
│   ├── prisma
│   ├── redis
│   ├── routes
│   ├── services
│   └── utils
└── test
    ├── rateLimiter.service.test.ts
    └── stats.service.test.ts
```

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` only if you want to override the defaults for
   local development outside Docker. The example file includes both host-local
   URLs and Docker-internal URLs so the same repo can support `npm run dev` and
   `docker compose up`.

## Steps To Run The Project

### Docker Compose

Use this path if you want the full stack with zero manual database or Redis
setup:

```bash
docker compose up
```

The API will be available at `http://localhost:3000`.

To stop everything and remove the database volume:

```bash
docker compose down -v
```

### Local Development

1. Start MySQL and Redis:

```bash
docker compose up -d mysql redis
```

2. Generate the Prisma client:

```bash
npm run prisma:generate
```

3. Apply committed migrations:

```bash
npm run prisma:migrate:deploy
```

4. Start the API in watch mode:

```bash
npm run dev
```

### Testing

Run unit tests:

```bash
npm test
```

Run the concurrency/load test against a running service:

```bash
npm run load:test
```

## One-Command Docker Startup

From a fresh clone, this works with zero manual setup:

```bash
docker compose up
```

What happens automatically:

- Docker builds the app image with a multi-stage build.
- The app container runs `npm run prisma:migrate:deploy` before the server
  starts.
- Migration verification fails fast if any migration directory is missing either
  `migration.sql` or `down.sql`.
- Prisma applies only checked-in migrations. There is no `prisma db push` or
  runtime schema sync magic.

If you want a clean reset of the stack:

```bash
docker compose down -v
```

## Migration Workflow

Schema changes must be committed as migrations. Do not use `prisma db push`.

Create a new migration file without auto-applying schema changes:

```bash
npm run prisma:migrate:create -- --name <migration_name>
```

Then add the matching rollback file:

```text
prisma/migrations/<timestamp>_<migration_name>/migration.sql
prisma/migrations/<timestamp>_<migration_name>/down.sql
```

Verify the migration set:

```bash
npm run migrations:verify
```

Apply the checked-in migrations:

```bash
npm run prisma:migrate:deploy
```

Roll back the most recently applied migration with its `down.sql`:

```bash
npm run prisma:migrate:down
```

The rollback command is intentionally single-step and uses the latest applied
migration only.

## API

### `POST /request`

Request body:

```json
{
	"user_id": "user_1",
	"payload": {
		"sample": true
	}
}
```

Success:

```json
{
	"status": "accepted"
}
```

Rate limited:

```json
{
	"error": "rate_limit_exceeded",
  "message": "Max <RATE_LIMIT> requests per <RATE_WINDOW_MS/1000> seconds exceeded"
}
```

### `GET /stats`

- `GET /stats`
- `GET /stats?user_id=user_1`

Example response:

```json
{
	"users": [
		{
			"user_id": "user_1",
			"total_requests": 10,
			"accepted_requests": 5,
			"rejected_requests": 5
		}
	]
}
```

## Optional Enhancements (Config-Gated)

These features are disabled by default, so existing behavior is unchanged unless
you explicitly enable them.

- Deferred processing queue (BullMQ)
- Optional delayed enqueue when a request is rate limited
- Optional batching for queue inserts
- Redis cache for `GET /stats`

Environment flags:

```bash
ENABLE_DEFERRED_PROCESSING=false
ENABLE_RATE_LIMIT_QUEUE_FALLBACK=false
RATE_LIMIT_QUEUE_DELAY_MS=60000
QUEUE_NAME=request-processing
QUEUE_ATTEMPTS=3
QUEUE_BACKOFF_MS=1000
ENABLE_QUEUE_BATCHING=false
QUEUE_BATCH_SIZE=25
QUEUE_BATCH_WINDOW_MS=50
ENABLE_STATS_CACHE=false
STATS_CACHE_TTL_SECONDS=10
```

Queue mechanism details:

- Queue backend: BullMQ with Redis.
- Queue and worker are initialized only when queue features are enabled.
- Job retries: exponential backoff with `QUEUE_ATTEMPTS` and
  `QUEUE_BACKOFF_MS`.
- Queue mode for accepted request deferral: controlled by
  `ENABLE_DEFERRED_PROCESSING`.
- Queue mode for rate-limit fallback enqueue: controlled by
  `ENABLE_RATE_LIMIT_QUEUE_FALLBACK`.
- Batching: when `ENABLE_QUEUE_BATCHING=true`, queue inserts are grouped using
  `QUEUE_BATCH_SIZE` and `QUEUE_BATCH_WINDOW_MS`.

Request flow with queue:

- Accepted path with deferred processing enabled and successful enqueue: returns
  `200` immediately.
- Accepted path with deferred processing enabled but enqueue failure: falls back
  to synchronous payload handling to preserve behavior.
- Rate-limited path always returns `429` with the same contract (`Retry-After`
  + body).
- Rate-limited path with queue fallback enabled: payload is also enqueued with
  delay `RATE_LIMIT_QUEUE_DELAY_MS` for later processing.
- Stats path with cache enabled: `GET /stats` first checks Redis.
- Stats path on cache miss: data is read from MySQL and cached with
  `STATS_CACHE_TTL_SECONDS`.
- Stats write path: relevant cache keys are invalidated on every stats update.

Reliability and compatibility notes:

- All queue behavior is strictly config-enabled and default-off.
- Existing API contracts for `POST /request` and `GET /stats` are preserved.
- Redis/MySQL failure handling remains unchanged for core rate limiting and
  statistics persistence.

## Design Decisions

- Fastify over Express: I went with Fastify for the HTTP layer. It’s
  significantly faster, but more importantly, its plugin architecture and schema
  validation make the routing feel much more predictable as the app grows.
- Redis as the "Brain": To keep rate limiting consistent across multiple
  instances, I used Redis as the single source of truth. It prevents the
  "split-brain" issue where different nodes have different ideas of a user's
  quota.
- Atomic Sliding Window: I implemented the sliding-window logic using a Redis
  sorted set and a Lua script. This ensures the "check-and-update" step is
  atomic, so we don't run into race conditions when a user hammers the API with
  concurrent requests.
- Stateless Scaling: MySQL handles the long-term analytics, while Redis handles
  the transient rate-limit state. Keeping these separate ensures the API tier
  remains stateless—I can spin up or kill containers without losing the
  "heartbeat" of the rate limiter.
- Schema Discipline: I’m using Prisma for migrations, and they’re checked
  directly into the repo. Applying them on startup ensures the database schema
  is always in sync with the code, making the whole environment reproducible and
  easier to peer-review.
- Config-Gated Async Processing: Queue behavior is behind explicit feature
  flags, so teams can progressively roll out deferred processing and rollback
  instantly by config without changing code paths.
- Non-Breaking Queue Fallback: Even when async processing is enabled, enqueue
  failure falls back to synchronous handling for accepted requests. This keeps
  request semantics stable while still allowing async throughput gains.
- Controlled Rate-Limit Deferral: Optional delayed enqueue on rate-limited
  requests is implemented as additive behavior while preserving `429` responses.
  This allows downstream async recovery workflows without changing API contracts.
- Read-Through Stats Caching: `GET /stats` cache is read-through with targeted
  invalidation on writes. This keeps response shape and correctness while
  reducing repeated MySQL reads.
- Fail-Closed Strategy: If Redis goes down, the app intentionally fails closed.
  It’s a tough call, but allowing traffic to bypass the limiter would violate
  the service contract and potentially melt the downstream services.
- Best-Effort Analytics: Unlike rate limiting, I treated MySQL writes as
  "best-effort." If an analytics log fails, we catch the error and move on—I
  didn't want a transient DB hiccup to block a legitimate user request.
- Lean Docker Images: I used multi-stage builds for the Dockerfile. It keeps the
  production image lean by stripping out build-time dependencies, which speeds
  up deployments and reduces the attack surface.

## What I Would Improve With More Time

- Worker Isolation: Run queue workers as a dedicated process/container instead
  of in-process with the API server to improve horizontal scalability,
  fault-isolation, and independent autoscaling.
- Queue Idempotency: Add a deterministic job key/idempotency strategy to
  prevent duplicate side effects on retries or producer replays.
- Dead-Letter Queue (DLQ): Add an explicit DLQ flow for exhausted retries with
  replay tooling and operational runbooks.
- Queue Observability: Add metrics and alerts for queue depth, job age,
  retry/failure rates, and end-to-end processing latency.
- Cache Telemetry and Tuning: Track hit ratio, invalidation frequency, and stale
  read windows to tune TTL and key strategy.
- End-to-End Async Tests: Add integration tests that cover queue enqueue,
  delayed rate-limit fallback jobs, retry behavior, and cache invalidation under
  concurrency.
- End-to-End Testing: Currently, I’m relying on unit tests and a load script.
  Given more time, I’d set up a full integration suite in Docker to see how
  Fastify, Redis, and MySQL behave together under stress.
- Smarter Health Checks: I’d split the health and readiness probes. Right now,
  it's a bit binary; I want the orchestrator to know the difference between "the
  app is booting" and "Redis is unreachable."
- Observability: I’d love to get deeper metrics—specifically tracking Lua script
  latency and rejection spikes—to see exactly where the bottlenecks are before
  they become outages.
- Tracing: Under heavy concurrent load, debugging is a nightmare without
  correlation IDs. I’d implement structured request tracing early on.
- Auth Integration: The current setup uses a generic user_id. In a real-world
  scenario, I’d tie this to an actual auth provider or API key management
  system.
- Add authentication or API-key support so rate limiting can be tied to an
  authenticated principal instead of an arbitrary `user_id`.
- Migration Safety: I’d add a CI check to ensure every new migration includes a
  corresponding down.sql. It’s one of those things you don't think you need
  until a deployment goes sideways and you need a clean rollback path.

The load test fires concurrent requests for the same user and exits non-zero
unless accepted and rejected counts match the configured `RATE_LIMIT`.
