# @mattycatty/rolling-leaderboard

Headless, configurable rolling leaderboard service with dependency-injected storage/adapters.

## Why this package

- Keeps leaderboard domain logic separate from API framework code.
- Works in Bun and Node projects (ESM package output).
- Lets consumers choose their own storage/user lookup/metadata strategy.
- Supports per-category aggregation (`sum`, `max`, `min`) for mixed leaderboard types.
- Supports custom rolling-window key strategies for projects with bucketed storage.

## Install

1. npm (recommended)

```sh
npm install @mattycatty/rolling-leaderboard
```

2. Git dependency

```json
{
  "dependencies": {
    "@mattycatty/rolling-leaderboard": "github:mattycatty/rolling-leaderboard#v0.1.0"
  }
}
```

3. Monorepo workspace

```json
{
  "dependencies": {
    "@mattycatty/rolling-leaderboard": "workspace:^"
  }
}
```

## Runtime compatibility (Bun + Node)

- Package code is plain TypeScript/ESM and builds to `dist`.
- Consumers can run it in Node or Bun.
- Avoid Bun-only runtime APIs in exported library code.
- Bun is used for local test tooling here; that does not force consumers to run Bun.

## Exports

- `createLeaderboardService`
- `createRedisLeaderboardStore`
- `createMemoryLeaderboardStore`
- `RedisLeaderboardStore`
- `MemoryLeaderboardStore`
- `createLeaderboardBuilder` / `leaderboard`
- `lbSchema` / `lbBoard` / `lbTimeframe`
- `createRedisLb` / `createMemoryLb` / `createRedisLbFromUrl`
- `lbQuerySchema`
- Types and ports (`LeaderboardStorePort`, `UsernamePort`, etc.)

## Usage examples

### 1) Minimal headless usage

```ts
import { createLeaderboardService } from "@mattycatty/rolling-leaderboard";

type Category = "points" | "tasks_completed";
type Timeframe = "24h" | "7d";

const memory = new Map<string, number>(); // replace with real adapter

const service = createLeaderboardService<Category, Timeframe>(
  {
    categories: ["points", "tasks_completed"],
    defaultCategory: "points",
    timeframes: ["24h", "7d"],
    defaultTimeframe: "24h",
  },
  {
    store: {
      async ingestWindows() {
        throw new Error("Implement a real store adapter");
      },
      async buildRankingFromWindows() {
        throw new Error("Implement a real store adapter");
      },
      async getTopRankedUsers() {
        return null;
      },
      async getUserRank() {
        return null;
      },
      async getScoresBatch() {
        return new Map();
      },
    },
  },
);

void memory;
void service;
```

### 1b) Memory adapter for demos/tests

```ts
import {
  createLeaderboardService,
  createMemoryLeaderboardStore,
} from "@mattycatty/rolling-leaderboard";

const store = createMemoryLeaderboardStore({
  categories: ["points", "tasks_completed"] as const,
  timeframes: ["24h"] as const,
});

const service = createLeaderboardService(
  {
    categories: ["points", "tasks_completed"] as const,
    defaultCategory: "points",
    timeframes: ["24h"] as const,
    defaultTimeframe: "24h",
  },
  { store },
);
```

### 2) Redis adapter usage (Node Redis client)

```ts
import { createClient } from "redis";
import {
  createLeaderboardService,
  createRedisLeaderboardStore,
} from "@mattycatty/rolling-leaderboard";

type Category = "points" | "tasks_completed";
type Timeframe = "24h";

const redis = createClient({ url: process.env.REDIS_URL! });
await redis.connect();

const store = createRedisLeaderboardStore<Category, Timeframe>(redis, {
  prefix: "lb",
  categories: ["points", "tasks_completed"],
  timeframes: ["24h"],
});

const service = createLeaderboardService<Category, Timeframe>(
  {
    categories: ["points", "tasks_completed"],
    defaultCategory: "points",
    timeframes: ["24h"],
    defaultTimeframe: "24h",
  },
  {
    store,
    usernames: {
      async getUsernames(userIds) {
        const names = await redis.hmGet("lb:usernames", userIds);
        const map = new Map<string, string>();
        userIds.forEach((id, i) => {
          if (names[i]) map.set(id, names[i]!);
        });
        return map;
      },
    },
  },
);

await service.ingest([
  ["u1", { points: 120, tasks_completed: 30 }],
  ["u2", { points: 95, tasks_completed: 50 }],
]);

await service.rebuild(["24h"]);

const leaderboard = await service.getLeaderboard({ timeframe: "24h", orderBy: "points" }, "u1");
console.log(leaderboard);
```

### 3) Redis with custom rolling windows and aggregation

```ts
const store = createRedisLeaderboardStore<
  "points" | "best_streak",
  "24h"
>(redis, {
  prefix: "lb",
  categories: ["points", "best_streak"],
  timeframes: ["24h"],
  categoryAggregation: {
    points: "sum",
    best_streak: "max",
  },
  resolveIngestKeys: ({ category, date }) => [
    `lb:window:${category}:${date.getUTCHours()}`,
  ],
  resolveBuildSourceKeys: ({ category }) => [
    `lb:window:${category}:0`,
    `lb:window:${category}:1`,
    `lb:window:${category}:2`,
  ],
});
```

### 4) Definition-first setup for stronger typesafety

```ts
import {
  defineLeaderboard,
  createServiceConfigFromDefinition,
  createRedisConfigFromDefinition,
  createLeaderboardService,
  createRedisLeaderboardStore,
} from "@mattycatty/rolling-leaderboard";

const definition = defineLeaderboard({
  categories: [
    { key: "points", aggregation: "sum" },
    { key: "best_streak", aggregation: "max" },
  ] as const,
  timeframes: ["day", "week", "month"] as const,
  defaultCategory: "points",
  defaultTimeframe: "day",
});

const store = createRedisLeaderboardStore(
  redis,
  createRedisConfigFromDefinition(definition, { prefix: "lb:engagement" }),
);

const service = createLeaderboardService(
  createServiceConfigFromDefinition(definition),
  { store },
);
```

### 5) Windowed key strategy builder

```ts
import { createWindowedLeaderboardRedisConfig } from "@mattycatty/rolling-leaderboard";

const built = createWindowedLeaderboardRedisConfig({
  prefix: "lb",
  categories: ["points", "best_streak"] as const,
  timeframes: ["day", "week"] as const,
  windows: ["h", "d", "all"] as const,
  isComparisonCategory: (category) => category === "best_streak",
  shouldIngestForTimeframe: (timeframe) => timeframe === "day",
  getBuildWindowSources: (timeframe, date) =>
    timeframe === "day"
      ? [{ window: "h", date }]
      : [{ window: "d", date }],
  formatWindowKey: (prefix, window, date, category) =>
    `${prefix}:window:${window}:${date.toISOString()}:${category}`,
});

const store = createRedisLeaderboardStore(redis, built.redis);
```

### 6) Drizzle-style leaderboard builder

```ts
import { leaderboard } from "@mattycatty/rolling-leaderboard";

const engagement = leaderboard("engagement")
  .sum("points")
  .max("best_streak")
  .rolling("day", { unit: "hour", size: 24 })
  .rolling("week", { unit: "day", size: 7 })
  .allTime("lifetime")
  .defaults({
    metric: "points",
    timeframe: "day",
    limit: 25,
    maxLimit: 100,
  })
  .build();

const engine = engagement.createRedisEngine(redis, {
  usernames,
  metadata,
});

await engine.insert("u1", { points: 15, best_streak: 3 });
await engine.update("u1", { points: 5, best_streak: 7 }); // alias of insert()
await engine.refresh(["day", "week", "lifetime"]);

const result = await engine.select(
  { timeframe: "day", orderBy: "points" },
  "u1",
);
```

### 7) Separated definitions + query behavior

```ts
import {
  boardKeys,
  createRedisLb,
  lbSchema,
  lbBoard,
  lbTimeframe,
} from "@mattycatty/rolling-leaderboard";

const schema = lbSchema({
  prefix: "lb",
  timeframes: {
    day: lbTimeframe.rolling("day", 1),
    lifetime: lbTimeframe.all(),
  },
})
  .leaderboards({
    profit: lbBoard.sum("day", "lifetime"),
    best_streak: lbBoard.max("lifetime"),
  })
  .defaults({
    leaderboard: "profit",
    timeframe: "lifetime",
    sort: "desc",
    limit: 25,
    maxLimit: 100,
  });

const boardNames = boardKeys(schema); // ["profit", "best_streak"]

const runtime = createRedisLb(redis, schema);

await runtime.write.ingest([
  ["u1", { profit: 100, best_streak: 10 }],
  ["u2", { profit: 250, best_streak: 6 }],
]);
await runtime.write.rebuild(["day", "lifetime"]);

const user = await runtime.query.user({
  leaderboard: "profit",
  timeframe: "day",
  userId: "u1",
});

const top = await runtime.query.list({
  leaderboard: "profit",
  timeframe: "day",
  direction: "desc",
  limit: 10,
});
```

### 8) Query Zod schema from leaderboard definition

```ts
import { lbQuerySchema } from "@mattycatty/rolling-leaderboard";

const query = lbQuerySchema(schema);

const parsedList = query.list.parse({
  leaderboard: "profit",
  timeframe: "day",
  limit: 25,
});
```

### 9) Create Redis runtime directly from URL

```ts
import { createRedisLbFromUrl } from "@mattycatty/rolling-leaderboard";

const runtime = await createRedisLbFromUrl(process.env.REDIS_URL!, schema);

await runtime.write.rebuild(["day", "lifetime"]);
await runtime.close();
```

Note: `createRedisLbFromUrl(...)` dynamically imports `redis`, so your app should include `redis` as a dependency.

## Validation behavior

- Service creation throws `LeaderboardConfigError` for invalid defaults.
- Query handling throws `LeaderboardQueryError` for unknown categories/timeframes.
- Invalid `limit` values are clamped to `[1, maxLimit]`.

## Testing

- `bun run test`: fast/default test path.
- `bun run test:integration`: Redis integration tests.

Integration behavior:

- Uses `REDIS_URL` if provided.
- Otherwise starts `redis:7-alpine` via testcontainers.

## CI and release starter files

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `.changeset/config.json`

## Project docs

- `CONTRIBUTING.md`
- `docs/architecture.md`
- `docs/testing.md`

## Separate repository setup checklist

1. Create new GitHub repo (for package only).
2. Copy package files from `packages/rolling-leaderboard/*` to repo root.
3. Add repository metadata in `package.json` (`repository`, `homepage`, `bugs`, `license`, `author`).
4. Enable branch protection on `main`.
5. Add required secrets:
   - `NPM_TOKEN` (for npm publish), or configure GitHub Packages.
6. Run CI once on PR.
7. Create first changeset and merge to `main`.
8. Run release workflow to publish first tag/version.

## Integrating back into API later

1. Add dependency in API (`workspace:^`, npm version, or git URL).
2. Build a thin API composition module that wires:
   - Redis client -> `createRedisLeaderboardStore`
   - user lookup port
   - metadata lookup port
3. Replace direct API leaderboard module calls with package service calls.
4. Keep API tests for integration behavior; keep package tests focused on contract behavior.
