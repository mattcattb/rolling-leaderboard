# Architecture

## Goals

- Keep leaderboard domain logic framework-agnostic.
- Allow multiple storage backends via ports/adapters.
- Keep typing strict across categories, timeframes, and ranking config.

## Layers

- Core service (`src/service.ts`):
  - Query normalization and validation.
  - Leaderboard response composition.
  - Current-user inclusion behavior.
- Ports (`src/ports.ts`):
  - Store port for ingest/rebuild/read.
  - Optional ports for usernames and metadata.
- Adapters (`src/adapters/*`):
  - `RedisLeaderboardStore` for production use.
  - `MemoryLeaderboardStore` for demos/unit tests.
- Definition helpers (`src/definition.ts`):
  - Single source of truth for categories/timeframes and aggregation.
  - Derives both service config and redis config.
- Fluent schema builder (`src/builder.ts`):
  - Drizzle-style chain API for metrics/timeframes/defaults.
  - Produces typed blueprints and runtime helpers (`insert`, `update`, `refresh`, `select`).
- Separated schema + query runtime (`src/schema.ts`):
  - Defines leaderboards with per-board aggregation + supported timeframes.
  - Includes a schema-builder DSL (`lbSchema`, `lbBoard`, `lbTimeframe`).
  - Exposes explicit query behaviors (`query.user`, `query.list`).
  - Supports query validation via `lbQuerySchema(...)`.

## Data Flow

1. Ingest deltas via `service.ingest(entries, date)`.
2. Store adapter writes into window keys.
3. Rebuild materializes rank keys from windows.
4. Read path fetches ranked users + per-user scores.
5. Optional username/metadata ports enrich output.

## Redis Adapter Notes

- Supports per-category aggregation: `sum | max | min`.
- Supports custom key resolvers for rolling windows:
  - `resolveIngestKeys`
  - `resolveBuildSourceKeys`
  - `resolveRankKey`
  - `resolveWindowTtlSeconds`

## Type Safety Strategy

- Use literal unions for categories/timeframes.
- Prefer `defineLeaderboard(...)` to avoid drift.
- Validate runtime inputs in core service:
  - invalid config => `LeaderboardConfigError`
  - invalid query => `LeaderboardQueryError`
