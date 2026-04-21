# Rate-Limited API Service

Production-grade Fastify service that enforces a strict sliding-window rate limit of 5 requests per user per minute using Redis Lua scripting, while persisting per-user analytics in MySQL through Prisma.

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

2. Copy `.env.example` to `.env` only if you want to override the defaults for local development outside Docker.
   The example file includes both host-local URLs and Docker-internal URLs so the same repo can support `npm run dev` and `docker compose up`.

## One-Command Docker Startup

From a fresh clone, this works with zero manual setup:

```bash
docker compose up
```

What happens automatically:

- Docker builds the app image with a multi-stage build.
- The app container runs `npm run prisma:migrate:deploy` before the server starts.
- Migration verification fails fast if any migration directory is missing either `migration.sql` or `down.sql`.
- Prisma applies only checked-in migrations. There is no `prisma db push` or runtime schema sync magic.

If you want a clean reset of the stack:

```bash
docker compose down -v
```

## Running Locally

Start the infrastructure with Docker:

```bash
docker compose up -d mysql redis
```

Generate the Prisma client and run the API in development mode:

```bash
npm run prisma:generate
npm run dev
```

Apply committed migrations explicitly:

```bash
npm run prisma:migrate:deploy
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

The rollback command is intentionally single-step and uses the latest applied migration only.

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
  "message": "Max 5 requests per minute exceeded"
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

## Testing

Run unit tests:

```bash
npm test
```

Run the concurrency/load test against a running service:

```bash
npm run load:test
```

The load test fires 100 concurrent requests for the same user and exits non-zero unless exactly 5 requests succeed and 95 are rejected.
