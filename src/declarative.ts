import { createRedisLeaderboardStore, type RedisLeaderboardClient } from "./adapters";
import type { LeaderboardAggregation, RedisStoreConfig } from "./adapters/redis.store";
import {
  createLeaderboardService,
  type CreateLeaderboardServiceDeps,
  type CreateLeaderboardServiceConfig,
} from "./service";
import type { LeaderboardMetadata } from "./types";

export type RollingUnit = "hour" | "day" | "month";
type WindowToken = "h" | "d" | "m" | "all";

export type MetricSpec = {
  aggregation?: LeaderboardAggregation;
};

export type TimeframeSpec =
  | { type: "all" }
  | { type: "rolling"; unit: RollingUnit; size: number };

export type DeclarativeLeaderboard<
  TMetrics extends Record<string, MetricSpec>,
  TTimeframes extends Record<string, TimeframeSpec>,
> = {
  prefix?: string;
  metrics: TMetrics;
  timeframes: TTimeframes;
  defaults: {
    metric: keyof TMetrics & string;
    timeframe: keyof TTimeframes & string;
    sort?: "asc" | "desc";
    limit?: number;
    maxLimit?: number;
  };
};

export type MetricKeyFromDeclarative<
  TDef extends { metrics: Record<string, unknown> },
> = keyof TDef["metrics"] & string;

export type TimeframeKeyFromDeclarative<
  TDef extends { timeframes: Record<string, unknown> },
> = keyof TDef["timeframes"] & string;

export type ScoreDeltaFromDeclarative<
  TDef extends { metrics: Record<string, unknown> },
> = Record<MetricKeyFromDeclarative<TDef>, number>;

export function defineDeclarativeLeaderboard<
  const TMetrics extends Record<string, MetricSpec>,
  const TTimeframes extends Record<string, TimeframeSpec>,
>(definition: DeclarativeLeaderboard<TMetrics, TTimeframes>) {
  return definition;
}

function tokenForUnit(unit: RollingUnit): WindowToken {
  if (unit === "hour") return "h";
  if (unit === "day") return "d";
  return "m";
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function snapUtc(date: Date, unit: RollingUnit): Date {
  const out = new Date(date);
  if (unit === "hour") {
    out.setUTCMinutes(0, 0, 0);
    return out;
  }
  if (unit === "day") {
    out.setUTCHours(0, 0, 0, 0);
    return out;
  }
  out.setUTCHours(0, 0, 0, 0);
  out.setUTCDate(1);
  return out;
}

function addUtc(date: Date, unit: RollingUnit, delta: number): Date {
  const out = new Date(date);
  if (unit === "hour") {
    out.setUTCHours(out.getUTCHours() + delta);
    return out;
  }
  if (unit === "day") {
    out.setUTCDate(out.getUTCDate() + delta);
    return out;
  }
  out.setUTCMonth(out.getUTCMonth() + delta);
  return out;
}

function formatWindowTs(date: Date, token: Exclude<WindowToken, "all">): string {
  const yyyy = date.getUTCFullYear();
  const mm = pad2(date.getUTCMonth() + 1);
  const dd = pad2(date.getUTCDate());
  if (token === "h") {
    return `${yyyy}-${mm}-${dd}:${pad2(date.getUTCHours())}`;
  }
  if (token === "d") {
    return `${yyyy}-${mm}-${dd}`;
  }
  return `${yyyy}-${mm}`;
}

function rollingDates(spec: Extract<TimeframeSpec, { type: "rolling" }>, now: Date): Date[] {
  const dates: Date[] = [];
  let cursor = snapUtc(now, spec.unit);
  const size = Math.max(1, spec.size);

  for (let idx = 0; idx < size; idx += 1) {
    dates.push(new Date(cursor));
    cursor = addUtc(cursor, spec.unit, -1);
  }

  return dates;
}

function buildBundle<
  TMetrics extends Record<string, MetricSpec>,
  TTimeframes extends Record<string, TimeframeSpec>,
>(definition: DeclarativeLeaderboard<TMetrics, TTimeframes>) {
  type Metric = keyof TMetrics & string;
  type Timeframe = keyof TTimeframes & string;

  const prefix = definition.prefix ?? "lb";
  const metrics = Object.keys(definition.metrics) as Metric[];
  const timeframes = Object.keys(definition.timeframes) as Timeframe[];
  const canonicalIngestTimeframe = timeframes[0];

  const ingestTokens = new Set<WindowToken>();
  for (const timeframe of timeframes) {
    const spec = definition.timeframes[timeframe];
    if (spec.type === "all") {
      ingestTokens.add("all");
    } else {
      ingestTokens.add(tokenForUnit(spec.unit));
    }
  }

  const keys = {
    rank: (timeframe: Timeframe, metric: Metric) =>
      `${prefix}:ranking:${timeframe}:${metric}`,
    metadata: (timeframe: Timeframe) => `${prefix}:meta:${timeframe}`,
    names: () => `${prefix}:names`,
    window: (token: WindowToken, date: Date, metric: Metric) => {
      const ts = token === "all" ? "" : `:${formatWindowTs(date, token)}`;
      return `${prefix}:window:${token}${ts}:${metric}`;
    },
  };

  const categoryAggregation = Object.fromEntries(
    metrics.map((metric) => [
      metric,
      definition.metrics[metric].aggregation ?? "sum",
    ]),
  ) as Partial<Record<Metric, LeaderboardAggregation>>;

  const redis: RedisStoreConfig<Metric, Timeframe> = {
    prefix,
    categories: metrics,
    timeframes,
    categoryAggregation,
    resolveRankKey: ({ timeframe, category }) => keys.rank(timeframe, category),
    resolveIngestKeys: ({ timeframe, category, date }) => {
      if (timeframe !== canonicalIngestTimeframe) return [];
      return [...ingestTokens].map((token) => keys.window(token, date, category));
    },
    resolveBuildSourceKeys: ({ timeframe, category, date }) => {
      const spec = definition.timeframes[timeframe];
      if (spec.type === "all") {
        return [keys.window("all", date, category)];
      }
      const token = tokenForUnit(spec.unit);
      return rollingDates(spec, date).map((seriesDate) =>
        keys.window(token, seriesDate, category),
      );
    },
  };

  const service: CreateLeaderboardServiceConfig<Metric, Timeframe> = {
    categories: metrics,
    defaultCategory: definition.defaults.metric,
    timeframes,
    defaultTimeframe: definition.defaults.timeframe,
    defaultSort: definition.defaults.sort,
    defaultLimit: definition.defaults.limit,
    maxLimit: definition.defaults.maxLimit,
  };

  return { redis, service, keys };
}

export function createBundleFromDeclarative<
  TMetrics extends Record<string, MetricSpec>,
  TTimeframes extends Record<string, TimeframeSpec>,
>(definition: DeclarativeLeaderboard<TMetrics, TTimeframes>) {
  return buildBundle(definition);
}

export function createRedisLeaderboardEngineFromDeclarative<
  TMetrics extends Record<string, MetricSpec>,
  TTimeframes extends Record<string, TimeframeSpec>,
  TMetadata extends LeaderboardMetadata = LeaderboardMetadata,
>(
  client: RedisLeaderboardClient,
  definition: DeclarativeLeaderboard<TMetrics, TTimeframes>,
  deps: Omit<
    CreateLeaderboardServiceDeps<
      keyof TMetrics & string,
      keyof TTimeframes & string,
      TMetadata
    >,
    "store"
  >,
) {
  type Metric = keyof TMetrics & string;
  type Timeframe = keyof TTimeframes & string;

  const built = createBundleFromDeclarative(definition);
  const store = createRedisLeaderboardStore<Metric, Timeframe>(client, built.redis);
  const service = createLeaderboardService<Metric, Timeframe, TMetadata>(
    built.service,
    { ...deps, store },
  );

  return { ...built, store, service };
}
