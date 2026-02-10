# Contributing

Thanks for contributing to `rolling-leaderboard`.

## Prerequisites

- Bun `>=1.1`
- Node.js `>=18`
- Docker (optional, for local Redis container)

## Setup

```sh
bun install
```

## Development Commands

- Typecheck:

```sh
bun run typecheck
```

- Build:

```sh
bun run build
```

- Unit tests (default):

```sh
bun run test
```

- Integration tests (Redis):

```sh
REDIS_URL=redis://127.0.0.1:6379 RUN_INTEGRATION=1 bun run test:integration
```

## Local Redis for Integration Tests

```sh
docker run --rm -p 6379:6379 redis:7-alpine
```

Then run integration tests with `REDIS_URL`.

## Pull Request Guidelines

- Keep changes scoped and focused.
- Add or update tests for behavior changes.
- Update docs/examples when public API changes.
- Ensure CI passes (`quality` + `integration`).

## Versioning and Release

This repository uses Changesets.

- For user-facing changes, add a changeset:

```sh
bunx changeset
```

- Releases are published via GitHub Actions on `main`.
