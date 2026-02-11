import { createMemoryLeaderboardStore, type RedisLeaderboardClient } from "./adapters";
import {
  createBundleFromDeclarative,
  createRedisLeaderboardEngineFromDeclarative,
  defineDeclarativeLeaderboard,
  type DeclarativeLeaderboard,
  type MetricSpec,
  type RollingUnit,
  type TimeframeSpec,
} from "./declarative";
import { LeaderboardConfigError, createLeaderboardService, type CreateLeaderboardServiceDeps } from "./service";
import type { LeaderboardMetadata, LeaderboardQuery, LeaderboardResponse } from "./types";

type MetricMap = Record<string, MetricSpec>;
type TimeframeMap = Record<string, TimeframeSpec>;

type MetricKey<TMetrics extends MetricMap> = keyof TMetrics & string;
type TimeframeKey<TTimeframes extends TimeframeMap> = keyof TTimeframes & string;
type ScoreDelta<TMetrics extends MetricMap> = Record<MetricKey<TMetrics>, number>;

export type LeaderboardSchemaDefaults<
  TMetrics extends MetricMap,
  TTimeframes extends TimeframeMap,
> = {
  metric: MetricKey<TMetrics>;
  timeframe: TimeframeKey<TTimeframes>;
  sort?: "asc" | "desc";
  limit?: number;
  maxLimit?: number;
};

export type LeaderboardRuntime<
  TMetrics extends MetricMap,
  TTimeframes extends TimeframeMap,
  TMetadata extends LeaderboardMetadata = LeaderboardMetadata,
> = {
  insert: (
    userId: string,
    delta: ScoreDelta<TMetrics>,
    date?: Date,
  ) => Promise<void>;
  update: (
    userId: string,
    delta: ScoreDelta<TMetrics>,
    date?: Date,
  ) => Promise<void>;
  insertMany: (
    entries: Array<[userId: string, delta: ScoreDelta<TMetrics>]>,
    date?: Date,
  ) => Promise<void>;
  refresh: (
    timeframes: TimeframeKey<TTimeframes>[],
    date?: Date,
    ttlSeconds?: number,
  ) => Promise<void>;
  select: (
    query?: Partial<LeaderboardQuery<MetricKey<TMetrics>, TimeframeKey<TTimeframes>>>,
    currentUserId?: string | null,
  ) => Promise<LeaderboardResponse<MetricKey<TMetrics>, TMetadata | null>>;
};

export type LeaderboardBlueprint<
  TMetrics extends MetricMap,
  TTimeframes extends TimeframeMap,
> = {
  definition: DeclarativeLeaderboard<TMetrics, TTimeframes>;
  metricKeys: () => MetricKey<TMetrics>[];
  timeframeKeys: () => TimeframeKey<TTimeframes>[];
  bundle: () => ReturnType<
    typeof createBundleFromDeclarative<TMetrics, TTimeframes>
  >;
  createRedisEngine: <
    TMetadata extends LeaderboardMetadata = LeaderboardMetadata,
  >(
    client: RedisLeaderboardClient,
    deps?: Omit<
      CreateLeaderboardServiceDeps<
        MetricKey<TMetrics>,
        TimeframeKey<TTimeframes>,
        TMetadata
      >,
      "store"
    >,
  ) => ReturnType<
    typeof createRedisLeaderboardEngineFromDeclarative<
      TMetrics,
      TTimeframes,
      TMetadata
    >
  > &
    LeaderboardRuntime<TMetrics, TTimeframes, TMetadata>;
  createMemoryEngine: <
    TMetadata extends LeaderboardMetadata = LeaderboardMetadata,
  >(
    deps?: Omit<
      CreateLeaderboardServiceDeps<
        MetricKey<TMetrics>,
        TimeframeKey<TTimeframes>,
        TMetadata
      >,
      "store"
    >,
  ) => {
    service: ReturnType<
      typeof createLeaderboardService<
        MetricKey<TMetrics>,
        TimeframeKey<TTimeframes>,
        TMetadata
      >
    >;
    store: ReturnType<
      typeof createMemoryLeaderboardStore<
        MetricKey<TMetrics>,
        TimeframeKey<TTimeframes>
      >
    >;
  } & LeaderboardRuntime<TMetrics, TTimeframes, TMetadata>;
};

type BuildFn<
  TMetrics extends MetricMap,
  TTimeframes extends TimeframeMap,
  THasDefaults extends boolean,
> = THasDefaults extends true
  ? () => LeaderboardBlueprint<TMetrics, TTimeframes>
  : (
      defaults: LeaderboardSchemaDefaults<TMetrics, TTimeframes>,
    ) => LeaderboardBlueprint<TMetrics, TTimeframes>;

export type LeaderboardSchemaBuilder<
  TMetrics extends MetricMap,
  TTimeframes extends TimeframeMap,
  THasDefaults extends boolean = false,
> = {
  prefix: (
    prefix: string,
  ) => LeaderboardSchemaBuilder<TMetrics, TTimeframes, THasDefaults>;
  metric: <TKey extends string>(
    key: TKey,
    spec?: MetricSpec,
  ) => LeaderboardSchemaBuilder<
    TMetrics & Record<TKey, MetricSpec>,
    TTimeframes,
    THasDefaults
  >;
  sum: <TKey extends string>(
    key: TKey,
  ) => LeaderboardSchemaBuilder<
    TMetrics & Record<TKey, MetricSpec>,
    TTimeframes,
    THasDefaults
  >;
  max: <TKey extends string>(
    key: TKey,
  ) => LeaderboardSchemaBuilder<
    TMetrics & Record<TKey, MetricSpec>,
    TTimeframes,
    THasDefaults
  >;
  min: <TKey extends string>(
    key: TKey,
  ) => LeaderboardSchemaBuilder<
    TMetrics & Record<TKey, MetricSpec>,
    TTimeframes,
    THasDefaults
  >;
  timeframe: <TKey extends string>(
    key: TKey,
    spec: TimeframeSpec,
  ) => LeaderboardSchemaBuilder<
    TMetrics,
    TTimeframes & Record<TKey, TimeframeSpec>,
    THasDefaults
  >;
  rolling: <TKey extends string>(
    key: TKey,
    config: { unit: RollingUnit; size: number },
  ) => LeaderboardSchemaBuilder<
    TMetrics,
    TTimeframes & Record<TKey, TimeframeSpec>,
    THasDefaults
  >;
  allTime: <TKey extends string>(
    key: TKey,
  ) => LeaderboardSchemaBuilder<
    TMetrics,
    TTimeframes & Record<TKey, TimeframeSpec>,
    THasDefaults
  >;
  defaults: <
    TMetric extends MetricKey<TMetrics>,
    TTimeframe extends TimeframeKey<TTimeframes>,
  >(
    defaults: LeaderboardSchemaDefaults<TMetrics, TTimeframes> & {
      metric: TMetric;
      timeframe: TTimeframe;
    },
  ) => LeaderboardSchemaBuilder<TMetrics, TTimeframes, true>;
  build: BuildFn<TMetrics, TTimeframes, THasDefaults>;
};

type BuilderState<
  TMetrics extends MetricMap,
  TTimeframes extends TimeframeMap,
> = {
  prefix: string;
  metrics: TMetrics;
  timeframes: TTimeframes;
  defaults?: LeaderboardSchemaDefaults<TMetrics, TTimeframes>;
};

function createRuntimeHelpers<
  TMetrics extends MetricMap,
  TTimeframes extends TimeframeMap,
  TMetadata extends LeaderboardMetadata,
>(
  service: {
    ingest: (
      entries: Array<[userId: string, delta: ScoreDelta<TMetrics>]>,
      date?: Date,
    ) => Promise<void>;
    rebuild: (
      timeframes: TimeframeKey<TTimeframes>[],
      date?: Date,
      ttlSeconds?: number,
    ) => Promise<void>;
    getLeaderboard: (
      query?: Partial<LeaderboardQuery<MetricKey<TMetrics>, TimeframeKey<TTimeframes>>>,
      currentUserId?: string | null,
    ) => Promise<LeaderboardResponse<MetricKey<TMetrics>, TMetadata | null>>;
  },
): LeaderboardRuntime<TMetrics, TTimeframes, TMetadata> {
  return {
    insert: async (userId, delta, date) => service.ingest([[userId, delta]], date),
    update: async (userId, delta, date) => service.ingest([[userId, delta]], date),
    insertMany: async (entries, date) => service.ingest(entries, date),
    refresh: async (timeframes, date, ttlSeconds) =>
      service.rebuild(timeframes, date, ttlSeconds),
    select: async (query, currentUserId) => service.getLeaderboard(query, currentUserId),
  };
}

function createBlueprint<
  TMetrics extends MetricMap,
  TTimeframes extends TimeframeMap,
>(
  definition: DeclarativeLeaderboard<TMetrics, TTimeframes>,
): LeaderboardBlueprint<TMetrics, TTimeframes> {
  type Metric = MetricKey<TMetrics>;
  type Timeframe = TimeframeKey<TTimeframes>;

  const metricKeys = () => Object.keys(definition.metrics) as Metric[];
  const timeframeKeys = () => Object.keys(definition.timeframes) as Timeframe[];

  const createRedisEngine = <
    TMetadata extends LeaderboardMetadata = LeaderboardMetadata,
  >(
    client: RedisLeaderboardClient,
    deps: Omit<CreateLeaderboardServiceDeps<Metric, Timeframe, TMetadata>, "store"> = {},
  ) => {
    const built = createRedisLeaderboardEngineFromDeclarative(client, definition, deps);
    return {
      ...built,
      ...createRuntimeHelpers<TMetrics, TTimeframes, TMetadata>(built.service),
    };
  };

  const createMemoryEngine = <
    TMetadata extends LeaderboardMetadata = LeaderboardMetadata,
  >(
    deps: Omit<CreateLeaderboardServiceDeps<Metric, Timeframe, TMetadata>, "store"> = {},
  ) => {
    const built = createBundleFromDeclarative(definition);
    const store = createMemoryLeaderboardStore<Metric, Timeframe>({
      categories: metricKeys(),
      timeframes: timeframeKeys(),
    });
    const service = createLeaderboardService<Metric, Timeframe, TMetadata>(built.service, {
      ...deps,
      store,
    });
    return {
      store,
      service,
      ...createRuntimeHelpers<TMetrics, TTimeframes, TMetadata>(service),
    };
  };

  return {
    definition,
    metricKeys,
    timeframeKeys,
    bundle: () => createBundleFromDeclarative(definition),
    createRedisEngine,
    createMemoryEngine,
  };
}

function createBuilder<
  TMetrics extends MetricMap,
  TTimeframes extends TimeframeMap,
  THasDefaults extends boolean,
>(
  state: BuilderState<TMetrics, TTimeframes>,
): LeaderboardSchemaBuilder<TMetrics, TTimeframes, THasDefaults> {
  const assertUniqueMetric = (key: string) => {
    if (Object.prototype.hasOwnProperty.call(state.metrics, key)) {
      throw new LeaderboardConfigError(`Metric "${key}" is already defined`);
    }
  };
  const assertUniqueTimeframe = (key: string) => {
    if (Object.prototype.hasOwnProperty.call(state.timeframes, key)) {
      throw new LeaderboardConfigError(`Timeframe "${key}" is already defined`);
    }
  };

  const build = ((
    defaultsArg?: LeaderboardSchemaDefaults<TMetrics, TTimeframes>,
  ) => {
    const defaults = defaultsArg ?? state.defaults;
    if (!defaults) {
      throw new LeaderboardConfigError(
        "defaults are required. Call .defaults(...) or pass defaults to .build(defaults).",
      );
    }

    const metrics = Object.keys(state.metrics);
    if (metrics.length === 0) {
      throw new LeaderboardConfigError("At least one metric is required");
    }
    const timeframes = Object.keys(state.timeframes);
    if (timeframes.length === 0) {
      throw new LeaderboardConfigError("At least one timeframe is required");
    }
    if (!Object.prototype.hasOwnProperty.call(state.metrics, defaults.metric)) {
      throw new LeaderboardConfigError(`Unknown default metric: ${defaults.metric}`);
    }
    if (!Object.prototype.hasOwnProperty.call(state.timeframes, defaults.timeframe)) {
      throw new LeaderboardConfigError(
        `Unknown default timeframe: ${defaults.timeframe}`,
      );
    }

    const definition = defineDeclarativeLeaderboard({
      prefix: state.prefix,
      metrics: state.metrics,
      timeframes: state.timeframes,
      defaults,
    });

    return createBlueprint(definition);
  }) as BuildFn<TMetrics, TTimeframes, THasDefaults>;

  return {
    prefix: (prefix) =>
      createBuilder<TMetrics, TTimeframes, THasDefaults>({
        ...state,
        prefix,
      }),
    metric: (key, spec = {}) => {
      assertUniqueMetric(key);
      return createBuilder<
        TMetrics & Record<typeof key, MetricSpec>,
        TTimeframes,
        THasDefaults
      >({
        ...state,
        metrics: {
          ...state.metrics,
          [key]: spec,
        } as TMetrics & Record<typeof key, MetricSpec>,
      });
    },
    sum: (key) => {
      assertUniqueMetric(key);
      return createBuilder<
        TMetrics & Record<typeof key, MetricSpec>,
        TTimeframes,
        THasDefaults
      >({
        ...state,
        metrics: {
          ...state.metrics,
          [key]: { aggregation: "sum" },
        } as TMetrics & Record<typeof key, MetricSpec>,
      });
    },
    max: (key) => {
      assertUniqueMetric(key);
      return createBuilder<
        TMetrics & Record<typeof key, MetricSpec>,
        TTimeframes,
        THasDefaults
      >({
        ...state,
        metrics: {
          ...state.metrics,
          [key]: { aggregation: "max" },
        } as TMetrics & Record<typeof key, MetricSpec>,
      });
    },
    min: (key) => {
      assertUniqueMetric(key);
      return createBuilder<
        TMetrics & Record<typeof key, MetricSpec>,
        TTimeframes,
        THasDefaults
      >({
        ...state,
        metrics: {
          ...state.metrics,
          [key]: { aggregation: "min" },
        } as TMetrics & Record<typeof key, MetricSpec>,
      });
    },
    timeframe: (key, spec) => {
      assertUniqueTimeframe(key);
      return createBuilder<
        TMetrics,
        TTimeframes & Record<typeof key, TimeframeSpec>,
        THasDefaults
      >({
        ...state,
        timeframes: {
          ...state.timeframes,
          [key]: spec,
        } as TTimeframes & Record<typeof key, TimeframeSpec>,
      });
    },
    rolling: (key, config) => {
      assertUniqueTimeframe(key);
      return createBuilder<
        TMetrics,
        TTimeframes & Record<typeof key, TimeframeSpec>,
        THasDefaults
      >({
        ...state,
        timeframes: {
          ...state.timeframes,
          [key]: { type: "rolling", unit: config.unit, size: config.size },
        } as TTimeframes & Record<typeof key, TimeframeSpec>,
      });
    },
    allTime: (key) => {
      assertUniqueTimeframe(key);
      return createBuilder<
        TMetrics,
        TTimeframes & Record<typeof key, TimeframeSpec>,
        THasDefaults
      >({
        ...state,
        timeframes: {
          ...state.timeframes,
          [key]: { type: "all" },
        } as TTimeframes & Record<typeof key, TimeframeSpec>,
      });
    },
    defaults: (defaults) =>
      createBuilder<TMetrics, TTimeframes, true>({
        ...state,
        defaults,
      }),
    build,
  };
}

export function createLeaderboardBuilder(name?: string) {
  return createBuilder<{}, {}, false>({
    prefix: name ? `lb:${name}` : "lb",
    metrics: {},
    timeframes: {},
  });
}

export const leaderboard = createLeaderboardBuilder;
