# Testing

## Test Types

- Unit tests:
  - Validate core behavior and config/query guards.
  - Use `MemoryLeaderboardStore` to keep tests fast.
- Integration tests:
  - Validate Redis adapter behavior end-to-end.
  - Use real Redis with `REDIS_URL`.

## Commands

- Unit/default tests:

```sh
bun run test
```

- Integration tests:

```sh
REDIS_URL=redis://127.0.0.1:6379 RUN_INTEGRATION=1 bun run test:integration
```

## CI Behavior

- `quality` job runs typecheck and build.
- `integration` job runs Redis-backed integration tests using a Redis service container.

## Why Redis Integration Tests Matter

The Redis adapter has ranking semantics (`sum/max/min`, unions, ranks, scores) that should be verified against an actual Redis server to avoid false confidence from mocks.
