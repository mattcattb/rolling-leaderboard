import {
  createMemoryLeaderboardStore,
  createRedisLeaderboardStore,
  type RedisLeaderboardClient,
} from "./adapters";
import type { LeaderboardAggregation, RedisStoreConfig } from "./adapters/redis.store";
import type { TimeframeSpec } from "./declarative";
import {
  LeaderboardConfigError,
  LeaderboardQueryError,
  createLeaderboardService,
  type CreateLeaderboardServiceDeps,
  type CreateLeaderboardServiceConfig,
} from "./service";

type WindowToken = "h" | "d" | "m" | "all";
type RollingUnit = "hour" | "day" | "month";

export type LeaderboardBoardDefinition<TTimeframe extends string> = {
  aggregation?: LeaderboardAggregation;
  timeframes: readonly TTimeframe[];
};
export type LbBoardDef<TTimeframe extends string> =
  LeaderboardBoardDefinition<TTimeframe>;

export type LeaderboardSchemaDefinition<
  TTimeframes extends Record<string, TimeframeSpec>,
  TBoards extends Record<
    string,
    LeaderboardBoardDefinition<keyof TTimeframes & string>
  >,
> = {
  prefix?: string;
  timeframes: TTimeframes;
  leaderboards: TBoards;
  defaults: {
    leaderboard: keyof TBoards & string;
    timeframe: keyof TTimeframes & string;
    sort?: "asc" | "desc";
    limit?: number;
    maxLimit?: number;
  };
};
export type LbSchemaDef<
  TTimeframes extends Record<string, TimeframeSpec>,
  TBoards extends Record<
    string,
    LeaderboardBoardDefinition<keyof TTimeframes & string>
  >,
> = LeaderboardSchemaDefinition<TTimeframes, TBoards>;

export type BoardKeyFromSchema<
  TSchema extends LeaderboardSchemaDefinition<any, any>,
> = keyof TSchema["leaderboards"] & string;
export type LbBoardKey<TSchema extends LeaderboardSchemaDefinition<any, any>> =
  BoardKeyFromSchema<TSchema>;

export type TimeframeKeyFromSchema<
  TSchema extends LeaderboardSchemaDefinition<any, any>,
> = keyof TSchema["timeframes"] & string;
export type LbTimeframeKey<
  TSchema extends LeaderboardSchemaDefinition<any, any>,
> = TimeframeKeyFromSchema<TSchema>;

export type TimeframesForBoardFromSchema<
  TSchema extends LeaderboardSchemaDefinition<any, any>,
  TBoard extends BoardKeyFromSchema<TSchema>,
> = TSchema["leaderboards"][TBoard]["timeframes"][number];

export type ScoreDeltaFromSchema<
  TSchema extends LeaderboardSchemaDefinition<any, any>,
> = Record<BoardKeyFromSchema<TSchema>, number>;

export type LeaderboardRankedRow<
  TBoard extends string,
> = {
  userId: string;
  rank: number;
  score: number;
  scores: Partial<Record<TBoard, number | null>>;
};

export const lbTimeframe = {
  all: (): TimeframeSpec => ({ type: "all" }),
  rolling: (unit: RollingUnit, size: number): TimeframeSpec => ({
    type: "rolling",
    unit,
    size,
  }),
} as const;

export const lbBoard = {
  sum: <const TTimeframes extends readonly string[]>(
    ...timeframes: TTimeframes
  ): LeaderboardBoardDefinition<TTimeframes[number]> => ({
    aggregation: "sum",
    timeframes,
  }),
  max: <const TTimeframes extends readonly string[]>(
    ...timeframes: TTimeframes
  ): LeaderboardBoardDefinition<TTimeframes[number]> => ({
    aggregation: "max",
    timeframes,
  }),
  min: <const TTimeframes extends readonly string[]>(
    ...timeframes: TTimeframes
  ): LeaderboardBoardDefinition<TTimeframes[number]> => ({
    aggregation: "min",
    timeframes,
  }),
} as const;

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

export function defineLbSchema<
  const TTimeframes extends Record<string, TimeframeSpec>,
  const TBoards extends Record<
    string,
    LeaderboardBoardDefinition<keyof TTimeframes & string>
  >,
>(definition: LeaderboardSchemaDefinition<TTimeframes, TBoards>) {
  const boards = Object.keys(definition.leaderboards);
  if (boards.length === 0) {
    throw new LeaderboardConfigError("leaderboards must not be empty");
  }
  const timeframes = Object.keys(definition.timeframes);
  if (timeframes.length === 0) {
    throw new LeaderboardConfigError("timeframes must not be empty");
  }
  if (!boards.includes(definition.defaults.leaderboard)) {
    throw new LeaderboardConfigError("defaults.leaderboard must exist in leaderboards");
  }
  if (!timeframes.includes(definition.defaults.timeframe)) {
    throw new LeaderboardConfigError("defaults.timeframe must exist in timeframes");
  }
  const defaultBoard = definition.leaderboards[definition.defaults.leaderboard];
  if (!defaultBoard.timeframes.includes(definition.defaults.timeframe)) {
    throw new LeaderboardConfigError(
      `Default leaderboard "${definition.defaults.leaderboard}" does not support timeframe "${definition.defaults.timeframe}"`,
    );
  }
  return definition;
}
/** @deprecated Use `defineLbSchema(...)`. */
export const defineLeaderboardSchema = defineLbSchema;

export function lbSchema<
  const TTimeframes extends Record<string, TimeframeSpec>,
>(config: {
  prefix?: string;
  timeframes: TTimeframes;
}) {
  return {
    leaderboards: <
      const TBoards extends Record<
        string,
        LeaderboardBoardDefinition<keyof TTimeframes & string>
      >,
    >(
      leaderboards: TBoards,
    ) => ({
      defaults: <
        const TBoard extends keyof TBoards & string,
        const TTimeframe extends keyof TTimeframes & string,
      >(
        defaults: {
          leaderboard: TBoard;
          timeframe: TTimeframe;
          sort?: "asc" | "desc";
          limit?: number;
          maxLimit?: number;
        },
      ) =>
        defineLbSchema({
          prefix: config.prefix,
          timeframes: config.timeframes,
          leaderboards,
          defaults,
        }),
    }),
  };
}
/** @deprecated Use `lbSchema(...)`. */
export const createLeaderboardSchema = lbSchema;

export function boardKeys<
  TSchema extends LeaderboardSchemaDefinition<any, any>,
>(definition: TSchema): [BoardKeyFromSchema<TSchema>, ...BoardKeyFromSchema<TSchema>[]] {
  const keys = Object.keys(definition.leaderboards) as Array<BoardKeyFromSchema<TSchema>>;
  if (keys.length === 0) {
    throw new LeaderboardConfigError("leaderboards must not be empty");
  }
  return [keys[0], ...keys.slice(1)];
}
/** @deprecated Use `boardKeys(...)`. */
export const boardKeysFromSchema = boardKeys;

export function timeframeKeys<
  TSchema extends LeaderboardSchemaDefinition<any, any>,
>(definition: TSchema): [
  TimeframeKeyFromSchema<TSchema>,
  ...TimeframeKeyFromSchema<TSchema>[],
] {
  const keys = Object.keys(definition.timeframes) as Array<TimeframeKeyFromSchema<TSchema>>;
  if (keys.length === 0) {
    throw new LeaderboardConfigError("timeframes must not be empty");
  }
  return [keys[0], ...keys.slice(1)];
}
/** @deprecated Use `timeframeKeys(...)`. */
export const timeframeKeysFromSchema = timeframeKeys;

export function bundleFromSchema<
  const TTimeframes extends Record<string, TimeframeSpec>,
  const TBoards extends Record<
    string,
    LeaderboardBoardDefinition<keyof TTimeframes & string>
  >,
>(
  definition: LeaderboardSchemaDefinition<TTimeframes, TBoards>,
): {
  redis: RedisStoreConfig<keyof TBoards & string, keyof TTimeframes & string>;
  service: CreateLeaderboardServiceConfig<keyof TBoards & string, keyof TTimeframes & string>;
  keys: {
    rank: (
      timeframe: keyof TTimeframes & string,
      board: keyof TBoards & string,
    ) => string;
    metadata: (timeframe: keyof TTimeframes & string) => string;
    names: () => string;
    window: (token: WindowToken, date: Date, board: keyof TBoards & string) => string;
  };
  supports: {
    boardHasTimeframe: (
      board: keyof TBoards & string,
      timeframe: keyof TTimeframes & string,
    ) => boolean;
    boards: Array<keyof TBoards & string>;
    timeframes: Array<keyof TTimeframes & string>;
  };
} {
  type Board = keyof TBoards & string;
  type Timeframe = keyof TTimeframes & string;

  const prefix = definition.prefix ?? "lb";
  const boards = Object.keys(definition.leaderboards) as Board[];
  const timeframes = Object.keys(definition.timeframes) as Timeframe[];
  const canonicalIngestTimeframe = timeframes[0];

  const boardHasTimeframe = (board: Board, timeframe: Timeframe) =>
    definition.leaderboards[board].timeframes.includes(timeframe);

  const boardTokens = new Map<Board, WindowToken[]>();
  for (const board of boards) {
    const tokens = new Set<WindowToken>();
    for (const timeframe of definition.leaderboards[board].timeframes) {
      const spec = definition.timeframes[timeframe];
      if (spec.type === "all") {
        tokens.add("all");
      } else {
        tokens.add(tokenForUnit(spec.unit));
      }
    }
    boardTokens.set(board, [...tokens]);
  }

  const keys = {
    rank: (timeframe: Timeframe, board: Board) =>
      `${prefix}:ranking:${timeframe}:${board}`,
    metadata: (timeframe: Timeframe) => `${prefix}:meta:${timeframe}`,
    names: () => `${prefix}:names`,
    window: (token: WindowToken, date: Date, board: Board) => {
      const ts = token === "all" ? "" : `:${formatWindowTs(date, token)}`;
      return `${prefix}:window:${token}${ts}:${board}`;
    },
  };

  const categoryAggregation = Object.fromEntries(
    boards.map((board) => [
      board,
      definition.leaderboards[board].aggregation ?? "sum",
    ]),
  ) as Partial<Record<Board, LeaderboardAggregation>>;

  const redis: RedisStoreConfig<Board, Timeframe> = {
    prefix,
    categories: boards,
    timeframes,
    categoryAggregation,
    resolveRankKey: ({ timeframe, category }) => keys.rank(timeframe, category),
    resolveIngestKeys: ({ timeframe, category, date }) => {
      if (timeframe !== canonicalIngestTimeframe) return [];
      return (boardTokens.get(category) ?? []).map((token) =>
        keys.window(token, date, category),
      );
    },
    resolveBuildSourceKeys: ({ timeframe, category, date }) => {
      if (!boardHasTimeframe(category, timeframe)) return [];
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

  const service: CreateLeaderboardServiceConfig<Board, Timeframe> = {
    categories: boards,
    defaultCategory: definition.defaults.leaderboard,
    timeframes,
    defaultTimeframe: definition.defaults.timeframe,
    defaultSort: definition.defaults.sort,
    defaultLimit: definition.defaults.limit,
    maxLimit: definition.defaults.maxLimit,
  };

  return {
    redis,
    service,
    keys,
    supports: {
      boardHasTimeframe,
      boards,
      timeframes,
    },
  };
}
/** @deprecated Use `bundleFromSchema(...)`. */
export const createBundleFromSchema = bundleFromSchema;

function unique<TValue>(values: readonly TValue[]): TValue[] {
  return [...new Set(values)];
}

export function createLbQuery<
  const TTimeframes extends Record<string, TimeframeSpec>,
  const TBoards extends Record<
    string,
    LeaderboardBoardDefinition<keyof TTimeframes & string>
  >,
>(
  definition: LeaderboardSchemaDefinition<TTimeframes, TBoards>,
  deps: {
    store: {
      getTopRankedUsers: (
        timeframe: keyof TTimeframes & string,
        board: keyof TBoards & string,
        limit: number,
        descending: boolean,
      ) => Promise<Array<{ userId: string; score: number; rank: number }> | null>;
      getUserRank: (
        userId: string,
        timeframe: keyof TTimeframes & string,
        board: keyof TBoards & string,
        descending: boolean,
      ) => Promise<{ userId: string; score: number; rank: number } | null>;
      getScoresBatch: (
        timeframe: keyof TTimeframes & string,
        userIds: string[],
      ) => Promise<Map<string, Record<keyof TBoards & string, number>>>;
    };
  },
) {
  type Board = keyof TBoards & string;
  type Timeframe = keyof TTimeframes & string;

  const allBoards = Object.keys(definition.leaderboards) as Board[];
  const boardHasTimeframe = (board: Board, timeframe: Timeframe) =>
    definition.leaderboards[board].timeframes.includes(timeframe);

  const assertSupported = (board: Board, timeframe: Timeframe) => {
    if (!boardHasTimeframe(board, timeframe)) {
      throw new LeaderboardQueryError(
        `Leaderboard "${board}" does not support timeframe "${timeframe}"`,
      );
    }
  };

  const buildScoreMap = (
    timeframe: Timeframe,
    userScores: Record<Board, number> | undefined,
    include: Board[],
  ): Partial<Record<Board, number | null>> => {
    const out = {} as Partial<Record<Board, number | null>>;
    for (const board of include) {
      out[board] = boardHasTimeframe(board, timeframe)
        ? (userScores?.[board] ?? 0)
        : null;
    }
    return out;
  };

  const getUserRankWithScores = async <TBoard extends Board>(query: {
    leaderboard: TBoard;
    timeframe: TimeframesForBoardFromSchema<
      LeaderboardSchemaDefinition<TTimeframes, TBoards>,
      TBoard
    >;
    userId: string;
    direction?: "asc" | "desc";
    includeScores?: readonly Board[];
  }): Promise<LeaderboardRankedRow<Board> | null> => {
    const timeframe = query.timeframe as Timeframe;
    assertSupported(query.leaderboard, timeframe);

    const descending = (query.direction ?? definition.defaults.sort ?? "desc") === "desc";
    const ranked = await deps.store.getUserRank(
      query.userId,
      timeframe,
      query.leaderboard,
      descending,
    );
    if (!ranked) return null;

    const include = unique<Board>(
      [query.leaderboard, ...(query.includeScores ?? allBoards)] as Board[],
    );
    const scoreRows = await deps.store.getScoresBatch(timeframe, [query.userId]);
    const scores = buildScoreMap(timeframe, scoreRows.get(query.userId), include);

    return {
      userId: ranked.userId,
      rank: ranked.rank,
      score: ranked.score,
      scores,
    };
  };

  const getTopOrBottomWithScores = async <TBoard extends Board>(query: {
    leaderboard: TBoard;
    timeframe: TimeframesForBoardFromSchema<
      LeaderboardSchemaDefinition<TTimeframes, TBoards>,
      TBoard
    >;
    direction?: "asc" | "desc";
    limit?: number;
    includeScores?: readonly Board[];
  }): Promise<Array<LeaderboardRankedRow<Board>>> => {
    const timeframe = query.timeframe as Timeframe;
    assertSupported(query.leaderboard, timeframe);

    const descending = (query.direction ?? definition.defaults.sort ?? "desc") === "desc";
    const limit = Math.max(1, Math.min(definition.defaults.maxLimit ?? 100, query.limit ?? 25));
    const ranked = await deps.store.getTopRankedUsers(
      timeframe,
      query.leaderboard,
      limit,
      descending,
    );
    if (!ranked || ranked.length === 0) return [];

    const include = unique<Board>(
      [query.leaderboard, ...(query.includeScores ?? allBoards)] as Board[],
    );
    const userIds = ranked.map((entry) => entry.userId);
    const scoreRows = await deps.store.getScoresBatch(timeframe, userIds);

    return ranked.map((entry) => ({
      userId: entry.userId,
      rank: entry.rank,
      score: entry.score,
      scores: buildScoreMap(timeframe, scoreRows.get(entry.userId), include),
    }));
  };

  return {
    user: getUserRankWithScores,
    list: getTopOrBottomWithScores,
  };
}
/** @deprecated Use `createLbQuery(...)`. */
export const createLeaderboardQueryApi = createLbQuery;

export function createRedisLb<
  const TTimeframes extends Record<string, TimeframeSpec>,
  const TBoards extends Record<
    string,
    LeaderboardBoardDefinition<keyof TTimeframes & string>
  >,
>(
  client: RedisLeaderboardClient,
  definition: LeaderboardSchemaDefinition<TTimeframes, TBoards>,
  deps: Omit<
    CreateLeaderboardServiceDeps<
      keyof TBoards & string,
      keyof TTimeframes & string,
      Record<string, never>
    >,
    "store"
  > = {},
) {
  type Board = keyof TBoards & string;
  type Timeframe = keyof TTimeframes & string;

  const built = bundleFromSchema(definition);
  const store = createRedisLeaderboardStore<Board, Timeframe>(client, built.redis);
  const service = createLeaderboardService<Board, Timeframe, Record<string, never>>(
    built.service,
    { ...deps, store },
  );
  const query = createLbQuery(definition, { store });

  return {
    definition,
    keys: built.keys,
    store,
    query,
    write: {
      ingest: service.ingest,
      rebuild: service.rebuild,
    },
  };
}
/** @deprecated Use `createRedisLb(...)`. */
export const createRedisLeaderboardRuntimeFromSchema = createRedisLb;

export async function createRedisLbFromUrl<
  const TTimeframes extends Record<string, TimeframeSpec>,
  const TBoards extends Record<
    string,
    LeaderboardBoardDefinition<keyof TTimeframes & string>
  >,
>(
  url: string,
  definition: LeaderboardSchemaDefinition<TTimeframes, TBoards>,
  deps: Omit<
    CreateLeaderboardServiceDeps<
      keyof TBoards & string,
      keyof TTimeframes & string,
      Record<string, never>
    >,
    "store"
  > = {},
) {
  let createClient: ((opts: { url: string }) => unknown) | undefined;
  try {
    ({ createClient } = await import("redis"));
  } catch {
    throw new LeaderboardConfigError(
      'Failed to import "redis". Install it in your app to use createRedisLbFromUrl().',
    );
  }

  const client = createClient?.({ url }) as RedisLeaderboardClient & {
    isOpen?: boolean;
    connect?: () => Promise<void>;
    quit?: () => Promise<void>;
    disconnect?: () => void;
  };

  if (!client) {
    throw new LeaderboardConfigError("Failed to create Redis client from URL");
  }

  if (!client.isOpen && client.connect) {
    await client.connect();
  }

  const runtime = createRedisLb(client, definition, deps);
  return {
    ...runtime,
    client,
    close: async () => {
      if (client.quit) {
        await client.quit();
        return;
      }
      client.disconnect?.();
    },
  };
}

export function createMemoryLb<
  const TTimeframes extends Record<string, TimeframeSpec>,
  const TBoards extends Record<
    string,
    LeaderboardBoardDefinition<keyof TTimeframes & string>
  >,
>(
  definition: LeaderboardSchemaDefinition<TTimeframes, TBoards>,
) {
  type Board = keyof TBoards & string;
  type Timeframe = keyof TTimeframes & string;

  const built = bundleFromSchema(definition);
  const store = createMemoryLeaderboardStore<Board, Timeframe>({
    categories: built.supports.boards,
    timeframes: built.supports.timeframes,
  });
  const service = createLeaderboardService<Board, Timeframe>(built.service, {
    store,
  });
  const query = createLbQuery(definition, { store });

  return {
    definition,
    keys: built.keys,
    store,
    query,
    write: {
      ingest: service.ingest,
      rebuild: service.rebuild,
    },
  };
}
/** @deprecated Use `createMemoryLb(...)`. */
export const createMemoryLeaderboardRuntimeFromSchema = createMemoryLb;
